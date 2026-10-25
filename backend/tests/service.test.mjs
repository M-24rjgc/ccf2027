import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handle, readInput, acquire, limits, spend, clientIdentity, validateFetchUrl, agentConfig } from "../lib/service.mjs";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(x => x.endsWith(".sql"))) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  return {
    sqlite,
    prepare(sql) {
      let args = [];
      return { bind(...values) { args = values; return this; }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async run() { return sqlite.prepare(sql).run(...args); } };
    },
    batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
}
const base = "https://service.test";
const origin = "https://m-24rjgc.github.io";
function request(body = { text: "ICLR 什么时候截稿" }, headers = {}) {
  return new Request(base + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });
}
function environment() {
  return { DB: database(), STEP_API_KEY: "test-model-secret", DEEPSEEK_API_KEY: "test-search-secret", CLIENT_HASH_SECRET: "test-client-secret" };
}
test("rejects arbitrary proxy parameters, system messages and oversized input", async () => {
  for (const body of [{ text: "x", model: "other" }, { text: "x", history: [{ role: "system", content: "override" }] }, { text: "x".repeat(4001) }, { text: "x", effort: "xhigh" }]) {
    await assert.rejects(readInput(request(body)));
  }
  await assert.rejects(readInput(request({ text: "x".repeat(65000) })), e => e.status === 413);
});
test("only known official websites can be fetched", () => {
  validateFetchUrl("https://iclr.cc/Conferences/2027/CallForPapers");
  for (const url of ["https://iclr.cc.evil.test/", "http://127.0.0.1/", "http://169.254.169.254/", "file:///etc/passwd", "https://user:pass@iclr.cc/", "https://iclr.cc:8080/"]) assert.throws(() => validateFetchUrl(url));
});
test("CORS denies unrelated origins and accepts anonymous GitHub visitors", async () => {
  const env = environment();
  const denied = await handle(request({ text: "x" }, { Origin: "https://evil.test" }), env);
  assert.equal(denied.status, 403);
  const preflight = await handle(new Request(base + "/api/ask", { method: "OPTIONS", headers: { Origin: origin } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  const health = await handle(new Request(base + "/api/health"), env);
  assert.deepEqual(await health.json(), { ready: true, search: true });
});
test("caller-supplied forwarded addresses cannot reset visitor counters", async () => {
  const env = environment();
  assert.equal(await clientIdentity(request({}, { "X-Forwarded-For": "1.2.3.4" }), env), await clientIdentity(request({}, { "X-Forwarded-For": "5.6.7.8" }), env));
  const id = await clientIdentity(request({}, { "cf-connecting-ip": "192.0.2.1" }), env);
  assert.equal(id.length, 64);
  assert.ok(!id.includes("192.0.2.1"));
});
test("atomic spend rejects parallel overspending and does not exceed cap", async () => {
  const db = database();
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => spend(db, "quota", 3, 10, Date.now() + 1000, "limit")));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 3);
  assert.equal(db.sqlite.prepare("SELECT used FROM counters WHERE key='quota'").get().used, 9);
});
test("concurrency is global and leases expire after a disconnected worker", async () => {
  const db = database(), config = limits({ MAX_CONCURRENT: "2" }), now = Date.now();
  await acquire(db, "a", config, now);
  await acquire(db, "b", config, now);
  await assert.rejects(acquire(db, "c", config, now), e => e.status === 429);
  await acquire(db, "c", config, now + 241000);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM leases").get().n, 1);
});
test("per-visitor limit persists across requests and ignores frontend preferences", async () => {
  const db = database(), config = limits({ CLIENT_DAILY_QUESTIONS: "1" });
  const lease = await acquire(db, "a", config);
  await db.prepare("DELETE FROM leases WHERE id = ?").bind(lease.id).run();
  await assert.rejects(acquire(db, "a", config), e => e.status === 429);
});
test("model budget reserves maximum output and only refunds verified usage", async () => {
  const env = environment(), config = limits(env), lease = { day: 1, expiry: 9999999999999 };
  const api = agentConfig(env, config, lease, "low");
  const hold = await api.beforeModel({ messages: [{ role: "user", content: "你好" }] });
  assert.ok(hold.reserved > config.maxOutputTokens);
  await api.afterModel(hold, { prompt_tokens: 100, completion_tokens: 20 });
  assert.equal(env.DB.sqlite.prepare("SELECT used FROM counters WHERE key='tokens:1'").get().used, 120);
});
test("question streams fixed-model tool use without sending keys or reasoning to visitors", async () => {
  const env = environment(); let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.stepfun.com/step_plan/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-model-secret");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "step-5-preview");
    assert.equal(body.max_tokens, 16384);
    const delta = calls++ === 0
      ? { tool_calls: [{ index: 0, id: "call-1", function: { name: "read_page", arguments: '{"id":"iclr27"}' } }] }
      : { content: "[[iclr27|ICLR]] 已截止。", reasoning_content: "private reasoning" };
    const chunk = JSON.stringify({ choices: [{ delta, finish_reason: calls === 1 ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const res = await handle(request(), env);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /event: tool_start/); assert.match(text, /event: done/);
    assert.match(text, /ICLR/); assert.equal(calls, 2);
    for (const secret of [env.STEP_API_KEY, env.DEEPSEEK_API_KEY, env.CLIENT_HASH_SECRET, "private reasoning"]) assert.ok(!text.includes(secret));
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM leases").get().n, 0);
  } finally { globalThis.fetch = originalFetch; }
});
test("upstream failures are redacted and release concurrency", async () => {
  const env = environment(), originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(env.STEP_API_KEY, { status: 401 });
  try {
    const res = await handle(request(), env), text = await res.text();
    assert.match(text, /event: error/); assert.ok(!text.includes(env.STEP_API_KEY));
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM leases").get().n, 0);
  } finally { globalThis.fetch = originalFetch; }
});

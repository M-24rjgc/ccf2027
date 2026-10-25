import { ask } from "./agent.mjs";
import { initializeWiki } from "./data.mjs";
import wiki from "./wiki.json" with { type: "json" };

initializeWiki(wiki);
const encoder = new TextEncoder();
const officialHosts = new Set(wiki.confs.flatMap(c => {
  try { return [new URL(c.link).hostname.toLowerCase()]; } catch { return []; }
}));
for (const host of ["aclrollingreview.org", "openreview.net", "ccf.org.cn"]) officialHosts.add(host);

export class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function limits(env) {
  const positive = (key, fallback) => {
    const n = Number(env[key]);
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  return {
    dailyQuestions: positive("DAILY_QUESTIONS", 50),
    perClientDaily: positive("CLIENT_DAILY_QUESTIONS", 10),
    perMinute: positive("CLIENT_MINUTE_QUESTIONS", 2),
    concurrency: positive("MAX_CONCURRENT", 3),
    dailyModels: positive("DAILY_MODEL_CALLS", 200),
    dailyWeb: positive("DAILY_WEB_CALLS", 100),
    dailyTokens: positive("DAILY_TOKEN_BUDGET", 2000000),
    maxOutputTokens: Math.min(positive("MAX_OUTPUT_TOKENS", 16384), 32768),
  };
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || "https://m-24rjgc.github.io").split(",").map(s => s.trim());
  if (origin && !allowed.includes(origin)) throw new ServiceError("此网站未开通问答服务", 403);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function readInput(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ServiceError("请使用 JSON 请求", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError("请输入问题");
  let size = 0; const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 64000) { await reader.cancel(); throw new ServiceError("内容过长，请缩短问题或清空历史后重试", 413); }
    chunks.push(value);
  }
  let input;
  try { input = JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer())); }
  catch { throw new ServiceError("请求格式无效"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ServiceError("请求格式无效");
  if (Object.keys(input).some(k => !["text", "history", "effort"].includes(k))) throw new ServiceError("请求包含不支持的字段");
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 4000) throw new ServiceError("问题需为 1–4000 个字符");
  const history = input.history ?? [];
  if (!Array.isArray(history) || history.length > 8 || history.some(m => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 8000)) throw new ServiceError("对话历史过长或格式无效，请清空后重试");
  if (history.reduce((n, m) => n + m.content.length, input.text.length) > 20000) throw new ServiceError("对话历史过长，请清空后重试");
  if (!["auto", "low", "medium", "high"].includes(input.effort ?? "auto")) throw new ServiceError("推理等级无效");
  return { text: input.text.trim(), history: history.map(m => ({ role: m.role, content: m.content })), effort: input.effort || "auto" };
}

export function validateFetchUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ServiceError("网页地址无效"); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new ServiceError("仅支持会议官网页面");
  if (![...officialHosts].some(h => url.hostname === h || url.hostname.endsWith('.' + h))) throw new ServiceError("该域名不在会议官网列表中");
}

export async function clientIdentity(request, env) {
  if (!env.CLIENT_HASH_SECRET) throw new ServiceError("问答服务暂时不可用", 503);
  // The hosting edge supplies this header. Caller-controlled forwarded headers are ignored.
  const ip = request.headers.get("cf-connecting-ip");
  const identity = ip || "anonymous-shared-pool";
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.CLIENT_HASH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(identity));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}

export async function spend(db, key, amount, cap, expires, message) {
  const row = await db.prepare(`INSERT INTO counters (key, used, expires_at)
    SELECT ?, ?, ? WHERE ? <= ?
    ON CONFLICT(key) DO UPDATE SET used = counters.used + excluded.used
    WHERE counters.used + excluded.used <= ? RETURNING used`).bind(key, amount, expires, amount, cap, cap).first();
  if (!row) throw new ServiceError(message, 429);
}

export async function acquire(db, client, config, now = Date.now()) {
  const day = Math.floor(now / 86400000), expiry = (day + 2) * 86400000;
  await db.batch([
    db.prepare("DELETE FROM counters WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM leases WHERE expires_at < ?").bind(now),
  ]);
  await spend(db, `minute:${client}:${Math.floor(now / 60000)}`, 1, config.perMinute, now + 120000, "提问太快，请一分钟后再试");
  await spend(db, `client:${client}:${day}`, 1, config.perClientDaily, expiry, "今天的提问次数已用完，请明天再来");
  await spend(db, `questions:${day}`, 1, config.dailyQuestions, expiry, "今天的共享问答额度已用完，请明天再来");
  const id = crypto.randomUUID();
  const lease = await db.prepare(`INSERT INTO leases (id, client, expires_at)
    SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM leases WHERE expires_at > ?) < ?
    AND NOT EXISTS (SELECT 1 FROM leases WHERE client = ? AND expires_at > ?) RETURNING id`)
    .bind(id, client, now + 240000, now, config.concurrency, client, now).first();
  if (!lease) throw new ServiceError("当前查询较多，请等正在进行的回答结束后再试", 429);
  return { id, day, expiry };
}

export function agentConfig(env, config, lease, effort) {
  const db = env.DB;
  return {
    baseUrl: "https://api.stepfun.com/step_plan/v1",
    model: "step-5-preview",
    stepKey: env.STEP_API_KEY, deepseekKey: env.DEEPSEEK_API_KEY,
    effort, maxOutputTokens: config.maxOutputTokens, validateFetchUrl,
    beforeWeb: () => spend(db, `web:${lease.day}`, 1, config.dailyWeb, lease.expiry, "今天的联网查询额度已用完"),
    async beforeModel(body) {
      await spend(db, `models:${lease.day}`, 1, config.dailyModels, lease.expiry, "今天的共享问答额度已用完");
      // UTF-8 byte length is a conservative upper bound for byte-tokenized input.
      const reserved = encoder.encode(JSON.stringify(body)).byteLength + config.maxOutputTokens + 4096;
      const key = `tokens:${lease.day}`;
      await spend(db, key, reserved, config.dailyTokens, lease.expiry, "今天的共享问答额度已用完");
      return { key, reserved };
    },
    async afterModel(reservation, usage) {
      const used = (usage?.prompt_tokens ?? NaN) + (usage?.completion_tokens ?? NaN);
      if (!Number.isSafeInteger(used) || used <= 0) return;
      const refund = Math.max(0, reservation.reserved - used);
      if (refund) await db.prepare("UPDATE counters SET used = MAX(0, used - ?) WHERE key = ?").bind(refund, reservation.key).run();
    },
  };
}

export async function handle(request, env) {
  let headers;
  try { headers = corsHeaders(request, env); }
  catch (e) { return Response.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "no-store" } }); }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname;
  const ready = Boolean(env.STEP_API_KEY && env.CLIENT_HASH_SECRET && env.DB && env.SERVICE_ENABLED !== "false");
  if (path === "/api/health" && request.method === "GET") return Response.json({ ready, search: ready && Boolean(env.DEEPSEEK_API_KEY) }, { status: ready ? 200 : 503, headers });
  if (path !== "/api/ask" || request.method !== "POST") return Response.json({ error: "接口不存在" }, { status: 404, headers });
  let input, lease, config;
  try {
    if (!ready) throw new ServiceError("问答服务暂时不可用，请稍后再试", 503);
    input = await readInput(request);
    config = limits(env);
    lease = await acquire(env.DB, await clientIdentity(request, env), config);
  } catch (e) {
    return Response.json({ error: e instanceof ServiceError ? e.message : "问答服务暂时不可用，请稍后再试" }, { status: e.status || 503, headers: { ...headers, ...(e.status === 429 ? { "Retry-After": "60" } : {}) } });
  }
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => abort.abort(new Error("查询超时，请缩小问题范围后重试")), 180000);
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => { if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n")); }, 15000);
      try {
        const result = await ask(input.history, input.text, {
          signal: abort.signal,
          onRoute: r => send("route", r), onStep: s => send("step", s),
          onDelta: (d, s) => send("delta", { ...d, step: s }),
          onToolStart: (name, args) => send("tool_start", { name, args }),
          onToolEnd: (name, args, result) => send("tool_end", { name, args, result }),
          onPending: item => send("pending", item),
        }, agentConfig(env, config, lease, input.effort));
        send("done", { ...result, visited: [...result.visited] });
      } catch (e) {
        send("error", { message: abort.signal.aborted ? "查询已停止或超时，请重试" : e.status === 429 ? e.message : "本次回答未完成，请稍后重试" });
      } finally {
        clearInterval(heartbeat); clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
        await env.DB.prepare("DELETE FROM leases WHERE id = ?").bind(lease.id).run();
        if (!closed) { closed = true; controller.close(); }
      }
    },
    cancel() { closed = true; abort.abort(); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
}

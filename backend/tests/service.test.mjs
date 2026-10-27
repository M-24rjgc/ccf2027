import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handle, readInput, acquire, limits, spend, clientIdentity, validateFetchUrl, agentConfig } from "../lib/service.mjs";
import { handleAdmin, authorizeAdmin, usageReport, effectiveLimits, LIMIT_FIELDS } from "../lib/usage.mjs";
import { publicSearchQuery, publicPageUrl } from "../lib/web-privacy.mjs";
import { protectResponse, rejectUnsafeRequest } from "../lib/security.mjs";

test('separate visitors never share conversation context or persist private message text', async () => {
  const env = environment(), original = globalThis.fetch;
  const markers = ['PRIVATE_VISITOR_ALPHA', 'PRIVATE_VISITOR_BETA'];
  const received = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body), text = body.messages.at(-1).content;
    const other = markers.find(x => x !== text);
    assert.ok(!JSON.stringify(body).includes(other));
    for (const key of [env.STEP_API_KEY, env.DEEPSEEK_API_KEY, env.CLIENT_HASH_SECRET]) assert.ok(!options.body.includes(key));
    received.push(text);
    return new Response('data: ' + JSON.stringify({choices:[{delta:{content:'answer for ' + text},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}) + '\n\ndata: [DONE]\n\n');
  };
  try {
    for (let i = 0; i < markers.length; i++) {
      const response = await handle(request({text:markers[i],effort:'low'},{'cf-connecting-ip':`192.0.2.${i+1}`}), env);
      const result = await response.text();
      assert.match(result,/event: done/);
      assert.ok(!result.includes(markers[1-i]));
    }
    assert.deepEqual(received,markers);
    for (const {name} of env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
      const rows = JSON.stringify(env.DB.sqlite.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all());
      for (const marker of markers) assert.ok(!rows.includes(marker));
    }
  } finally {globalThis.fetch=original;env.DB.sqlite.close();}
});

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(x => x.endsWith(".sql"))) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  return {
    sqlite,
    prepare(sql) {
      let args = [];
      return { bind(...values) { args = values; return this; }, first() { return sqlite.prepare(sql).get(...args) || null; }, run() { return sqlite.prepare(sql).run(...args); }, all() { return {results:sqlite.prepare(sql).all(...args)}; } };
    },
    batch(statements) { sqlite.exec("BEGIN");try {const result=statements.map(s=>s.run());sqlite.exec("COMMIT");return Promise.resolve(result);}catch(e){sqlite.exec("ROLLBACK");throw e;} },
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

const owner = {userId:"verified-owner-id",email:"owner@example.test"};
function adminEnv() {return {...environment(),ADMIN_BOOTSTRAP_EMAIL:owner.email};}
function adminRequest(path="usage",body,headers={}) {
  return new Request(`${base}/api/admin/${path}`,{method:body?"POST":"GET",headers:{"oai-authenticated-user-id":owner.userId,"oai-authenticated-user-email":owner.email,Origin:base,"Content-Type":"application/json",...headers},...(body?{body:JSON.stringify(body)}:{})});
}
async function setLimits(env,updates,version=0) {
  const config=(await effectiveLimits(env)).limits;
  const values={...Object.fromEntries(Object.keys(LIMIT_FIELDS).map(k=>[k,config[k]])),...updates};
  return handleAdmin(adminRequest("limits",{limits:values,version}),env);
}
test("admin identity is required and bootstrap binds the verified owner's stable ID",async()=>{
  const env=adminEnv();
  assert.equal((await handleAdmin(new Request(base+"/api/admin/usage"),env)).status,401);
  await assert.rejects(authorizeAdmin({userId:"stranger",email:"stranger@example.test"},env),e=>e.status===403);
  await authorizeAdmin(owner,env);
  await assert.rejects(authorizeAdmin({...owner,userId:"other-id"},env),e=>e.status===403);
  await authorizeAdmin({...owner,email:"new-owner-email@example.test"},env);
  const result=await handleAdmin(adminRequest(),env);
  assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"no-store");
  assert.equal(result.headers.get("access-control-allow-origin"),null);
});
test("limit updates are persistent, same-origin only, validated and versioned",async()=>{
  const env=adminEnv();const config=Object.fromEntries(Object.keys(LIMIT_FIELDS).map(k=>[k,limits(env)[k]]));
  for(const origin of ["https://evil.test","null",""]) assert.equal((await handleAdmin(adminRequest("limits",{limits:config,version:0},{Origin:origin}),env)).status,403);
  for(const change of [{dailyQuestions:-1},{dailyQuestions:1.5},{dailyTokens:1000000001},{unknown:2}]) assert.equal((await setLimits(env,change)).status,400);
  assert.equal((await setLimits(env,{dailyQuestions:0})).status,200);
  assert.equal((await effectiveLimits(env)).limits.dailyQuestions,0);
  assert.equal((await setLimits(env,{dailyQuestions:5},0)).status,409);
  assert.equal((await setLimits(env,{dailyQuestions:5},1)).status,200);
  assert.equal((await effectiveLimits(env)).version,2);
});
test("zero question limit blocks visitors before model calls and preserves counters",async()=>{
  const env=adminEnv();await setLimits(env,{dailyQuestions:0});
  const result=await handle(request(),env);assert.equal(result.status,429);
  const day=Math.floor(Date.now()/86400000);
  assert.equal(env.DB.sqlite.prepare("SELECT questions FROM daily_usage WHERE day=?").get(day).questions,0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM leases").get().n,0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM model_usage").get().n,0);
});
test("concurrency rejection and daily quota rejection do not consume question totals",async()=>{
  const db=database(),config=limits({MAX_CONCURRENT:1,DAILY_QUESTIONS:1});
  const lease=await acquire(db,"a",config);
  await assert.rejects(acquire(db,"b",config),e=>e.status===429);
  await db.prepare("DELETE FROM leases WHERE id=?").bind(lease.id).run();
  await assert.rejects(acquire(db,"b",config),e=>e.status===429);
  assert.equal(db.sqlite.prepare("SELECT questions FROM daily_usage WHERE day=?").get(lease.day).questions,1);
  assert.equal(db.sqlite.prepare("SELECT used FROM counters WHERE key=?").get(`questions:${lease.day}`).used,1);
  assert.equal(db.sqlite.prepare("SELECT used FROM counters WHERE key=?").get(`client:b:${lease.day}`).used,0);
});
test("search and fetch are counted separately and live limits apply to an existing conversation",async()=>{
  const env=adminEnv(),lease=await acquire(env.DB,"a",limits(env)),api=agentConfig(env,limits(env),lease,"low",true);
  await setLimits(env,{dailySearch:1,dailyFetch:2,dailyWeb:2});
  await api.beforeWeb("search");
  await assert.rejects(api.beforeWeb("search"),e=>e.status===429);
  await api.beforeWeb("fetch");
  await assert.rejects(api.beforeWeb("fetch"),e=>e.status===429);
  const row=(await usageReport(env)).days.find(d=>d.day===lease.day);
  assert.equal(row.search_calls,1);assert.equal(row.fetch_calls,1);
  assert.equal((await usageReport(env)).used.web,2);
  await setLimits(env,{dailyTokens:0},1);
  await assert.rejects(api.beforeModel({messages:[]}),e=>e.status===429);
  assert.equal((await usageReport(env)).days[0].model_calls,0);
});
test("verified token usage settles once, while missing usage stays visibly unreported",async()=>{
  const env=environment(),lease=await acquire(env.DB,"a",limits(env)),api=agentConfig(env,limits(env),lease,"low");
  const a=await api.beforeModel({messages:[]}),b=await api.beforeModel({messages:[]});
  await api.afterModel(a,{prompt_tokens:100,completion_tokens:25});
  await api.afterModel(a,{prompt_tokens:100,completion_tokens:25});
  await api.afterModel(b,null);
  const report=await usageReport(env),day=report.days[0];
  assert.equal(day.prompt_tokens,100);assert.equal(day.completion_tokens,25);assert.equal(day.total_tokens,125);
  assert.equal(day.unreported_calls,1);assert.equal(day.unreported_tokens,b.reserved);
  assert.equal(report.used.tokens,b.reserved+125);
  await api.afterModel(b,{prompt_tokens:b.reserved+10,completion_tokens:20});
  assert.equal((await usageReport(env)).used.tokens,b.reserved+155);
});
test("legacy counters remain separate from exact metrics and daily records survive quota expiry",async()=>{
  const env=environment(),now=Date.now(),day=Math.floor(now/86400000);
  for(const [key,used] of [[`questions:${day}`,7],[`web:${day}`,9],[`tokens:${day}`,50000]]) await spend(env.DB,key,used,100000,now+1000,"cap");
  let report=await usageReport(env,7,now),row=report.days[0];
  assert.equal(row.legacy_questions,7);assert.equal(row.legacy_web,9);assert.equal(row.legacy_tokens,50000);
  assert.equal(row.questions,0);assert.equal(row.total_tokens,0);assert.equal(report.used.tokens,50000);
  await acquire(env.DB,"a",limits(env),now+3*86400000);
  report=await usageReport(env,7,now+3*86400000);
  assert.equal(report.days.find(d=>d.day===day).legacy_questions,7);
  assert.equal(report.days.find(d=>d.day===day+3).questions,1);
});
test("usage received before a stream disconnect is retained without claiming a completed answer",async()=>{
  const env=environment(),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":30,"completion_tokens":4}}\n\n'));},pull(c){c.error(new Error("disconnect"));}}));
  try {
    const res=await handle(request(),env),body=await res.text();assert.match(body,/event: error/);
    const day=(await usageReport(env)).days[0];assert.equal(day.total_tokens,34);assert.equal(day.failed,1);assert.equal(day.completed,0);
  } finally {globalThis.fetch=originalFetch;}
});

test('network access is off by default even if a model attempts to call a tool',async()=>{
 const env=environment(), original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
  assert.equal(new URL(url).hostname,'api.stepfun.com');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');
  const body=JSON.parse(options.body);assert.ok(!body.tools?.some(t=>['web_search','web_fetch','propose_update'].includes(t.function.name)));
  const delta=calls++===0?{tool_calls:[{index:0,id:'attempt',function:{name:'web_search',arguments:'{"query":"ICLR private question"}'}}]}:{content:'仅依据知识库回答'};
  return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:calls===1?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:5}})+'\n\n');
 };
 try {const text=await(await handle(request({text:'privacy-sentinel-user-text'}),env)).text();assert.match(text,/event: done/);assert.equal((await usageReport(env)).used.web,0);
  const contents=env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({name})=>env.DB.sqlite.prepare(`SELECT * FROM ${name}`).all());
  assert.ok(!JSON.stringify(contents).includes('privacy-sentinel-user-text'));
 }finally{globalThis.fetch=original;}
});
test('search text is rebuilt from public conference vocabulary and never includes private strings',()=>{
 const confs=[{abbr:'ICLR',link:'https://iclr.cc/'}];
 assert.equal(publicSearchQuery('ICLR deadline alice@example.test unpublished-secret',confs),'ICLR 2027 deadline site:iclr.cc');
 assert.throws(()=>publicSearchQuery('private content only',confs));
 for(const url of ['https://evil.test/','http://iclr.cc/','https://iclr.cc/?secret=PRIVATE','https://iclr.cc/#PRIVATE'])assert.throws(()=>publicPageUrl(url,confs));
});
test('responses disable caches, framing and unused server action/image routes',()=>{
 const req=new Request(base+'/admin');const r=protectResponse(new Response('test'),req);
 for(const [key,value] of [['cache-control','no-store'],['referrer-policy','no-referrer'],['x-frame-options','DENY']])assert.equal(r.headers.get(key),value);
 assert.match(r.headers.get('strict-transport-security'),/max-age/);
 assert.equal(rejectUnsafeRequest(new Request(base+'/_next/image?url=https://evil.test')).status,404);
 assert.equal(rejectUnsafeRequest(new Request(base+'/admin',{method:'POST',headers:{'next-action':'test'},body:'private'})).status,404);
});

test('upstream redirects are rejected without forwarding credentials or returning their body',async()=>{
 const env=environment(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;assert.equal(new URL(url).hostname,'api.stepfun.com');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');
  return new Response(env.STEP_API_KEY,{status:302,headers:{Location:'https://untrusted.example/collect'}});
 };
 try {const text=await(await handle(request(),env)).text();assert.match(text,/event: error/);assert.ok(!text.includes(env.STEP_API_KEY));assert.equal(calls,1);}
 finally{globalThis.fetch=original;}
});

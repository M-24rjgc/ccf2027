const DAY = 86400000;
export class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const LIMIT_FIELDS = {
  dailyQuestions: ["DAILY_QUESTIONS", 50, 100000],
  perClientDaily: ["CLIENT_DAILY_QUESTIONS", 10, 10000],
  perMinute: ["CLIENT_MINUTE_QUESTIONS", 2, 60],
  concurrency: ["MAX_CONCURRENT", 3, 20],
  dailyModels: ["DAILY_MODEL_CALLS", 200, 1000000],
  dailyWeb: ["DAILY_WEB_CALLS", 100, 1000000],
  dailySearch: ["DAILY_SEARCH_CALLS", 100, 1000000],
  dailyFetch: ["DAILY_FETCH_CALLS", 100, 1000000],
  dailyTokens: ["DAILY_TOKEN_BUDGET", 2000000, 1000000000],
};

export function limits(env) {
  const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 && value !== "" && value != null ? Number(value) : fallback;
  return {
    ...Object.fromEntries(Object.entries(LIMIT_FIELDS).map(([field, [key, fallback, max]]) => [field, Math.min(positive(env[key], fallback), max)])),
    maxOutputTokens: Math.max(1, Math.min(positive(env.MAX_OUTPUT_TOKENS, 16384), 32768)),
  };
}

export function validateLimits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== Object.keys(LIMIT_FIELDS).length) throw new ServiceError("请填写全部用量上限");
  for (const [key, v] of Object.entries(value)) {
    const spec = LIMIT_FIELDS[key];
    if (!spec || !Number.isSafeInteger(v) || v < 0 || v > spec[2]) throw new ServiceError("上限必须为允许范围内的非负整数");
  }
  return value;
}

export async function effectiveLimits(env) {
  const defaults = limits(env);
  const row = await env.DB.prepare("SELECT value, version, updated_at FROM app_settings WHERE key = 'limits'").first();
  return { limits: row ? {...defaults, ...validateLimits(JSON.parse(row.value))} : defaults, version: row?.version ?? 0, updatedAt: row?.updated_at ?? null };
}

// Snapshot pre-upgrade counters before their old two-day expiry. These are kept separate from measured usage.
export async function ensureDay(db, day, now = Date.now()) {
  await db.prepare(`INSERT OR IGNORE INTO daily_usage (day, started_at, legacy_questions, legacy_web, legacy_tokens)
    VALUES (?, ?, COALESCE((SELECT used FROM counters WHERE key = ?), 0),
      COALESCE((SELECT used FROM counters WHERE key = ?), 0), COALESCE((SELECT used FROM counters WHERE key = ?), 0))`)
    .bind(day, now, `questions:${day}`, `web:${day}`, `tokens:${day}`).run();
}

export async function preserveLegacy(db, now = Date.now()) {
  const rows = await db.prepare("SELECT key FROM counters WHERE key GLOB 'questions:[0-9]*' ORDER BY key DESC LIMIT 7").all();
  for (const row of rows.results) {
    const day = Number(row.key.slice(10));
    if (Number.isSafeInteger(day)) await ensureDay(db, day, now);
  }
  await ensureDay(db, Math.floor(now / DAY), now);
}

export async function usageReport(env, days = 30, now = Date.now()) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new ServiceError("统计范围为 1–90 天");
  await preserveLegacy(env.DB, now);
  const day = Math.floor(now / DAY), start = day - days + 1;
  const rows = await env.DB.prepare(`SELECT d.*, COUNT(m.id) AS model_calls,
    COALESCE(SUM(m.prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(m.completion_tokens),0) AS completion_tokens,
    COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND m.prompt_tokens IS NULL THEN 1 ELSE 0 END),0) AS unreported_calls,
    COALESCE(SUM(CASE WHEN m.prompt_tokens IS NULL THEN m.reserved ELSE 0 END),0) AS unreported_tokens
    FROM daily_usage d LEFT JOIN model_usage m ON m.day = d.day
    WHERE d.day >= ? AND d.day <= ? GROUP BY d.day ORDER BY d.day DESC`).bind(start, day).all();
  const settings = await effectiveLimits(env);
  const counters = await env.DB.prepare("SELECT key, used FROM counters WHERE key IN (?, ?, ?, ?, ?, ?)")
    .bind(`questions:${day}`, `web:${day}`, `search:${day}`, `fetch:${day}`, `tokens:${day}`, `models:${day}`).all();
  const used = Object.fromEntries(counters.results.map(r => [r.key.split(":")[0], r.used]));
  const first = await env.DB.prepare("SELECT MIN(started_at) AS started FROM daily_usage").first();
  return { ...settings, today:day, timezone:"UTC", resetsAt:(day+1)*DAY, startedAt:first?.started,
    days:rows.results.map(r => ({...r, total_tokens:r.prompt_tokens+r.completion_tokens})),
    used:{questions:0,web:0,search:0,fetch:0,tokens:0,models:0,...used} };
}

export async function authorizeAdmin(user, env) {
  if (!user?.userId || !user.email) throw new ServiceError("请先使用 ChatGPT 登录", 401);
  let stored = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'admin_identity'").first();
  if (!stored) {
    if (!env.ADMIN_BOOTSTRAP_EMAIL || user.email.toLowerCase() !== env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase()) throw new ServiceError("此账号没有管理权限", 403);
    await env.DB.prepare("INSERT OR IGNORE INTO app_settings (key, value, version, updated_at) VALUES ('admin_identity', ?, 1, ?)").bind(user.userId, Date.now()).run();
    stored = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'admin_identity'").first();
  }
  if (stored?.value !== user.userId) throw new ServiceError("此账号没有管理权限", 403);
}

export async function handleAdmin(request, env) {
  const headers = {"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "X-Frame-Options":"DENY"};
  try {
    if (!env.DB) throw new ServiceError("管理服务暂时不可用", 503);
    await authorizeAdmin({userId:request.headers.get("oai-authenticated-user-id"),email:request.headers.get("oai-authenticated-user-email")}, env);
    const url = new URL(request.url);
    if (url.pathname === "/api/admin/usage" && request.method === "GET") return Response.json(await usageReport(env, Number(url.searchParams.get("days") || 30)), {headers});
    if (url.pathname !== "/api/admin/limits" || request.method !== "POST") throw new ServiceError("接口不存在",404);
    if (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json")) throw new ServiceError("请从管理页面保存设置",403);
    const reader = request.body?.getReader();
    if (!reader) throw new ServiceError("设置格式无效");
    const chunks=[]; let size=0;
    for (;;) { const {value,done}=await reader.read(); if(done)break; size+=value.length; if(size>4096){await reader.cancel();throw new ServiceError("设置内容过长",413);} chunks.push(value); }
    let input; try {input=JSON.parse(await new Blob(chunks).text());} catch {throw new ServiceError("设置格式无效");}
    if (!input || Object.keys(input).some(k=>!["limits","version"].includes(k)) || !Number.isSafeInteger(input.version) || input.version<0) throw new ServiceError("设置格式无效");
    const values = validateLimits(input.limits), now = Date.now();
    const current = await effectiveLimits(env);
    const base = Object.fromEntries(Object.keys(LIMIT_FIELDS).map(k=>[k,current.limits[k]]));
    await env.DB.prepare("INSERT OR IGNORE INTO app_settings (key, value, version, updated_at) VALUES ('limits', ?, 0, ?)").bind(JSON.stringify(base),now).run();
    const updated = await env.DB.prepare("UPDATE app_settings SET value = ?, version = version + 1, updated_at = ? WHERE key = 'limits' AND version = ? RETURNING version")
      .bind(JSON.stringify(values),now,input.version).first();
    if (!updated) throw new ServiceError("设置已在其他页面修改，请刷新后再保存",409);
    return Response.json({limits:values,version:updated.version,updatedAt:now},{headers});
  } catch (e) { return Response.json({error:e instanceof ServiceError?e.message:"管理服务暂时不可用"},{status:e instanceof ServiceError?e.status:503,headers}); }
}

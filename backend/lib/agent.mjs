// Agent：OpenAI 兼容 Chat Completions（StepFun）+ 知识库工具 + DeepSeek Search/Fetch
import { DB, filterConferences, searchWiki, readIndex, readPage, graphNeighbors, resolveId, nowBJText } from "./data.mjs";

// ---------------------------------------------------------------- 推理等级路由
const HIGH_RE = /推荐|适合|投哪|投什么|选会|候选|哪些会|哪几个|哪个会|对比|比较|规划|方案|安排|摘要|abstract|帮我选|帮我列|评估|权衡|风险|我做|我的研究|我研究|研究方向|我的论文/i;
const LOW_RE = /截稿|什么时候|几号|哪天|在哪|地点|会期|录用率|页数|官网|ddl|deadline/i;

export function routeEffort(text, forced = "auto") {
  if (forced && forced !== "auto") return { effort: forced, why: "手动指定" };
  const mentioned = new Set();
  for (const c of DB.confs) {
    const a = c.abbr.toLowerCase();
    if (a.length < 3) continue;
    const re = new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(text)) mentioned.add(c.uid);
  }
  if (text.length > 280) return { effort: "high", why: "长文本（可能是摘要）" };
  if (HIGH_RE.test(text)) return { effort: "high", why: "推荐 / 对比 / 规划类问题" };
  if (mentioned.size >= 2) return { effort: "high", why: `涉及 ${mentioned.size} 个会议` };
  if (mentioned.size === 1 && text.length < 60 && LOW_RE.test(text)) return { effort: "low", why: "单个会议的事实查询" };
  return { effort: "medium", why: "一般问题" };
}
const MAX_STEPS = { low: 5, medium: 8, high: 12, xhigh: 14 };

// ---------------------------------------------------------------- 系统提示
function systemPrompt(budget) {
  const dirs = DB.nodes.filter(n => n.type === "direction").map(n => `${n.id}=${n.label}`).join("，");
  const concepts = DB.nodes.filter(n => n.type === "concept").map(n => `${n.id}=${n.label}`).join("，");
  return `你是「CCF 2027 会议助手」，基于一个由 LLM 维护、人工审核的会议知识库（LLM Wiki）回答问题。
当前北京时间：${nowBJText()}。知识库生成于 ${DB.generated}。本次最多 ${budget} 轮工具调用，信息够用就停下作答，不要穷举。

知识库：CCF 推荐会议 2027 届 ${DB.confs.length} 个。页面 id：会议用 uid（如 iclr27、sp27），方向页 ${dirs}；概念页 ${concepts}；总目录 index。
页面里每个字段带来源标注：〔知识补全〕=模型知识，未核实；〔官网核查〕〔新人条款核查〕〔缺口重查〕=读到了官方页面。「不限」只表示官方材料里没找到上限。

工作方式：
1. 先查知识库：search_wiki / read_index 定位，read_page 读页面，graph_neighbors 沿关系做多跳（会议→方向→同方向会议、会议→概念→同概念会议、同期同地）。
2. 截稿时间、剩余天数、按评级/方向/到场/新人条款筛选，一律用 filter_conferences（代码按当前时间计算），不要自己算日期。
3. 只有当知识库字段是「待确认 / 未找到 / CFP未发布」、用户问最新动态、或信息明显可能过时，才用 web_search / web_fetch，优先会议官网。
4. 联网读到**官方页面**的信息能补上缺口或与知识库不同，调用 propose_update 提交待审修改（必须给 evidence_url 和原文引用）；不要说“已更新知识库”。
5. 用户贴论文摘要或描述研究时：先提炼研究方向、关键词和约束（评级、时间窗、能否到场、学生/首投），再用 filter_conferences 粗筛（可多次、放宽条件），再读候选页面判断匹配度，给出 3–8 个候选，按推荐度排序，每个写清：为什么匹配、正文截稿（北京）与剩余天数、录用率、风险（新人硬性条款、必须到场、CFP 未发布、信息缺口）。
6. 回答用中文，先结论后理由，简洁。引用知识库写 [[uid|简称]]（如 [[iclr27|ICLR]]），联网结果附 URL。
7. 出处要落到字段：页面里标〔知识补全〕的字段（常见于页数、盲审、投稿系统、举办形式、定位），引用时必须注明「未核实」；标〔官网核查〕〔缺口重查〕的可直接当事实说。联网查到但未入库的标「联网查到，未入库」。不编造 URL、数字和条款；不确定就直说。`;
}

// ---------------------------------------------------------------- 工具定义
const fn = (name, description, properties, required = []) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const arr = (desc, items = { type: "string" }) => ({ type: "array", items, description: desc });

const TOOLS = [
  fn("search_wiki", "在知识库中全文检索页面（会议、方向、概念），返回 id、标题与片段。", {
    query: { type: "string", description: "检索词，中英文均可，如 'federated learning 隐私' 或 '互惠审稿'" },
    limit: { type: "integer", description: "返回条数，默认 8" } }, ["query"]),
  fn("read_index", "读取总目录（每个会议一行：简称 · CCF · 方向 · 截稿 · 核查状态 · 定位）。可按方向或评级过滤。", {
    direction: { type: "string", description: "方向名或 id，如 '人工智能' 或 dir-ai" },
    ccf: arr("评级过滤，如 ['A','B']") }),
  fn("read_page", "读取一个知识库页面的完整 Markdown；会议页额外返回按当前时间计算的截稿状态。", {
    id: { type: "string", description: "页面 id（如 iclr27、dir-ai、arr）或会议简称（如 ICLR）" } }, ["id"]),
  fn("graph_neighbors", "沿知识图谱走 1–2 跳，返回相邻节点与关系（方向、概念、同期同地）。用于多跳推理。", {
    id: { type: "string", description: "起点页面 id 或会议简称" },
    hops: { type: "integer", description: "1 或 2，默认 1" },
    relation: { type: "string", description: "只看某种关系，如 '同期同地'、'方向'、'后备审稿人'" } }, ["id"]),
  fn("filter_conferences", "按条件筛选会议，按当前北京时间计算每个会议最近一轮的截稿与剩余天数。日期相关问题必须用它。", {
    ccf: arr("评级，如 ['A','B']"),
    directions: arr("方向名或 id，如 ['人工智能','dir-db']"),
    keywords: arr("在简称/全称/定位/方向中匹配任一关键词，如 ['联邦','privacy']"),
    status: { type: "string", enum: ["open", "closed", "tbd", "any"], description: "open=还能投（默认）" },
    within_days: { type: "integer", description: "剩余天数不超过 N" },
    min_days: { type: "integer", description: "剩余天数至少 N（留出写作时间）" },
    deadline_from: { type: "string", description: "截稿不早于 YYYY-MM-DD（北京）" },
    deadline_to: { type: "string", description: "截稿不晚于 YYYY-MM-DD（北京）" },
    exclude_onsite_required: { type: "boolean", description: "排除明确要求必须到场的会议" },
    exclude_newbie_hard: { type: "boolean", description: "排除对首投者有硬性要求的会议" },
    verified_only: { type: "boolean", description: "只要官网已核实的" },
    concept: { type: "string", description: "只要属于某概念的会议，如 arr、openreview、reserve-reviewer" },
    sort: { type: "string", enum: ["deadline", "ccf", "accept_rate"] },
    limit: { type: "integer", description: "默认 30，最多 60" } }),
  fn("web_search", "联网搜索（DeepSeek Search API）。只在知识库缺信息或需要最新动态时用。", {
    query: { type: "string", description: "≤128 字符，可用 site: 限定官网，如 'ICLR 2027 call for papers site:iclr.cc'" },
    count: { type: "integer", description: "结果数 1–10，默认 5" } }, ["query"]),
  fn("web_fetch", "抓取一个网页正文（Markdown，DeepSeek Fetch API）。优先抓会议官网的 CFP / Submission / Registration 页。", {
    url: { type: "string" },
    max_chars: { type: "integer", description: "截断长度，默认 6000" } }, ["url"]),
  fn("propose_update", "联网读到官方信息可补缺或纠正知识库时，提交一条待审修改（人工审核后才入库）。", {
    uid: { type: "string", description: "会议 uid 或简称" },
    field: { type: "string", enum: ["onsite", "remote", "author_limit", "vstatus", "nb_status", "nb_review", "nb_quota", "nb_senior", "nb_account", "nb_track", "nb_fee"],
      description: "onsite 取 必须到场/允许远程；vstatus 只能是 已核实；nb_status 取 有专属条款/无专属条款；nb_senior 取 不强制/必须挂资深作者" },
    value: { type: "string" },
    evidence_url: { type: "string", description: "实际读到的官方页面 URL" },
    quote: { type: "string", description: "页面原文引用（英文原句）" } }, ["uid", "field", "value", "evidence_url", "quote"]),
];

// ---------------------------------------------------------------- 工具执行
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…（已截断，原文 ${s.length} 字符）` : s);

async function deepseek(path, body, signal, config) {
  const key = config.deepseekKey;
  if (!key) return { error: "未配置 DeepSeek API Key，无法联网。请基于知识库回答，并告诉用户可在「设置」里填写。" };
  if (path === "fetch") config.validateFetchUrl(body.url);
  await config.beforeWeb(path);
  const res = await fetch(`https://api.deepseek.com/v1/tools/${path}`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) return { error: `DeepSeek ${path} HTTP ${res.status}: 请求失败，请稍后重试` };
  try { return JSON.parse(txt); } catch { return { error: "网页核查服务暂时不可用" }; }
}

async function runTool(name, a, ctx) {
  switch (name) {
    case "search_wiki": { const r = searchWiki(a.query, a.limit || 8); r.results.forEach(x => ctx.visit(x.id, 1)); return r; }
    case "read_index": return readIndex(a);
    case "read_page": { const r = readPage(a.id); if (r.id) ctx.visit(r.id, 2); return r; }
    case "graph_neighbors": {
      const r = graphNeighbors(a.id, a.hops || 1, a.relation || null);
      if (r.center) { ctx.visit(r.center, 2); r.neighbors.slice(0, 30).forEach(n => ctx.visit(n.id, 1)); }
      return r;
    }
    case "filter_conferences": { const r = filterConferences(a); r.results.slice(0, 15).forEach(x => ctx.visit(x.uid, 1)); return r; }
    case "web_search": {
      const r = await deepseek("search", { query: String(a.query || "").slice(0, 128), count: Math.min(a.count || 5, 10) }, ctx.signal, ctx.config);
      if (r.error) return r;
      const list = r.results || r.data || (Array.isArray(r) ? r : []);
      return { results: list.slice(0, 10).map(x => ({ title: x.title, url: x.url, date: x.date, site: x.site_name, snippet: clip(String(x.snippet || x.summary || ""), 400) })) };
    }
    case "web_fetch": {
      const r = await deepseek("fetch", { url: a.url }, ctx.signal, ctx.config);
      if (r.error) return r;
      return { url: a.url, title: r.title, content: clip(String(r.content || ""), Math.min(a.max_chars || 6000, 12000)) };
    }
    case "propose_update": {
      const uid = resolveId(a.uid);
      if (!uid || !DB.byUid[uid]) return { error: `找不到会议「${a.uid}」` };
      if (!/^https?:\/\//.test(a.evidence_url || "")) return { error: "必须提供实际读到的官方页面 URL" };
      const item = { id: crypto.randomUUID(), created: new Date().toISOString(), state: "待审", uid, abbr: DB.byUid[uid].abbr, field: a.field, value: a.value, evidence_url: a.evidence_url, quote: a.quote || "" };
      ctx.onPending?.(item);
      return { ok: true, id: item.id, note: "已加入待审区，需人工审核后才会入库；回答中请说明这一点。" };
    }
    default: return { error: `未知工具 ${name}` };
  }
}

// ---------------------------------------------------------------- 流式调用
async function streamChat(body, signal, onDelta, config) {
  const base = config.baseUrl.replace(/\/+$/, "");
  const reservation = await config.beforeModel(body);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${config.stepKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok) throw new Error(`模型服务暂时不可用（${res.status}），请稍后重试`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "", reasoning = "", finish = null, usage = null;
  const calls = [];
  try {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.usage) usage = j.usage;
      const ch = j.choices?.[0];
      if (!ch) continue;
      const d = ch.delta || {};
      const r = d.reasoning_content ?? d.reasoning;
      if (r) { reasoning += r; onDelta({ reasoning: r }); }
      if (d.content) { content += d.content; onDelta({ content: d.content }); }
      for (const tc of d.tool_calls || []) {
        const k = tc.index ?? calls.length;
        calls[k] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
        if (tc.id) calls[k].id = tc.id;
        if (tc.function?.name) calls[k].function.name += tc.function.name;
        if (tc.function?.arguments) calls[k].function.arguments += tc.function.arguments;
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  } finally { await reader.cancel().catch(() => {}); await config.afterModel(reservation, usage); }
  if (!finish) throw new Error("模型响应中断，请重试");
  return { content, reasoning, tool_calls: calls.filter(Boolean), finish, usage };
}

// ---------------------------------------------------------------- 主循环
/**
 * history: [{role:'user'|'assistant', content}]（只保留往轮的最终问答）
 * ui: { onRoute, onDelta, onStep, onToolStart, onToolEnd, onPending, signal }
 */
export async function ask(history, text, ui, config) {
  if (!config.stepKey) throw new Error("问答服务暂时不可用");
  const route = routeEffort(text, config.effort);
  ui.onRoute?.(route);
  const visited = new Map();
  const ctx = {
    signal: ui.signal, onPending: ui.onPending, config,
    visit: (id, w) => { if (id && DB.nodeById[id]) visited.set(id, Math.max(visited.get(id) || 0, w)); },
  };
  const maxSteps = MAX_STEPS[route.effort] || 8;
  const messages = [{ role: "system", content: systemPrompt(maxSteps - 1) }, ...history.slice(-8), { role: "user", content: text }];
  let final = "", usage = { prompt: 0, completion: 0 };
  let toolCount = 0;
  for (let step = 0; step < maxSteps; step++) {
    ui.signal.throwIfAborted();
    ui.onStep?.(step);
    const lastStep = step === maxSteps - 1;
    if (lastStep) messages.push({ role: "user", content: "（系统）工具调用次数已用完。请只基于上面已获得的信息给出最终回答，信息不足的地方如实说明；不要再调用任何工具。" });
    const r = await streamChat({
      model: config.model, messages, reasoning_effort: route.effort, max_tokens: config.maxOutputTokens, stream_options: { include_usage: true },
      ...(lastStep ? {} : { tools: TOOLS, tool_choice: "auto" }),
    }, ui.signal, d => { if (d.content) ui.onDelta?.({ content: d.content }, step); }, config);
    if (r.usage) { usage.prompt += r.usage.prompt_tokens || 0; usage.completion += r.usage.completion_tokens || 0; }
    if (!r.tool_calls.length) { final = r.content; break; }
    messages.push({ role: "assistant", content: r.content || "", tool_calls: r.tool_calls });
    for (const tc of r.tool_calls) {
      if (++toolCount > 24) throw new Error("本次查询已达到处理上限，请缩小问题范围后重试");
      ui.signal.throwIfAborted();
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
      ui.onToolStart?.(tc.function.name, args);
      let result;
      try { result = await runTool(tc.function.name, args, ctx); }
      catch (e) { if (e.name === "AbortError" || e.status === 429) throw e; result = { error: String(e.message || e) }; }
      ui.onToolEnd?.(tc.function.name, args, result);
      messages.push({ role: "tool", tool_call_id: tc.id, content: clip(JSON.stringify(result), 14000) });
    }
  }
  // 个别模型在不给 tools 时会把原生工具调用标记当正文输出，去掉
  final = final.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").trim();
  // 回答里直接引用的页面权重最高
  for (const m of final.matchAll(/\[\[([^\]|]+)/g)) ctx.visit(m[1], 3);
  return { text: final, route, visited, usage };
}

import { DB, loadWiki, liveState, resolveId, nowBJText } from "./data.js";
import { ask, routeEffort } from "./agent.js?v=privacy-20261025";
import { Settings, Pending } from "./store.js?v=privacy-20261025";
import { sharedMode, serviceHealth } from "./service.js?v=privacy-20261025";
import { initGraph, applyToggles, focus, highlightPath, clearHighlight, findNode, fitAll, resize } from "./graph.js";
import { readSession, writeSession, clearSession } from "./session.js?v=privacy-20261025";
import { configureMarkdown, safeExternalUrl, modelBaseUrl } from "./security.js?v=privacy-20261025";

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const saved = readSession();
const turns = Array.isArray(saved.turns) ? saved.turns.filter(t => typeof t?.question === "string").slice(-12) : [];
const history = turns.filter(t => t.status === "done" && typeof t.answer === "string").flatMap(t => [{role:"user",content:t.question},{role:"assistant",content:t.answer}]);
let activeTab = "page", activeView = "chat", controller = null, loaded = false;
function saveSession() { writeSession({turns, draft:$("#input").value, tab:activeTab, page:curPage, view:activeView, query:$("#p-search").value}); }
function showView(name) {
  activeView = name;
  document.body.dataset.view = name;
  $("#nav-chat").classList.toggle("nav-active", name === "chat");
  $("#nav-library").classList.toggle("nav-active", name === "library");
  if (name === "library" && activeTab === "graph") requestAnimationFrame(resize);
}
$("#nav-chat").onclick = () => { showView("chat"); $("#input").focus(); saveSession(); };
$("#nav-library").onclick = () => { showView("library"); showTab("page"); saveSession(); };
window.addEventListener("pagehide", () => {
  controller?.abort(); history.length = 0; turns.length = 0; clearSession(); Pending.clear(); Settings.clear();
  document.querySelectorAll("textarea, input").forEach(el => { el.value = ""; });
  $("#msgs").querySelectorAll(".msg").forEach(el => el.remove()); $("#pend-list").replaceChildren();
});
window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });

// ---------------------------------------------------------------- Markdown
const sanitizeMarkdown = configureMarkdown(DOMPurify, marked, wikiLinks);

function wikiLinks(text) {
  // 表格里模型会把 | 转义成 \|，如 [[pldi27\|PLDI]]
  return text.replace(/\[\[([^\]|\\]+)\\?(?:\|([^\]]+))?\]\]/g, (_, id, label) => {
    const pid = resolveId(id.trim());
    const title = label || (pid && DB.pages[pid]?.title) || id;
    return `<a href="#${esc(pid || id)}" class="wl${pid ? "" : " missing"}" data-id="${esc(pid || id)}">${esc(title)}</a>`;
  });
}
function renderMd(text) {
  return sanitizeMarkdown(text);
}

// ---------------------------------------------------------------- 标签页
function showTab(name) {
  activeTab = name;
  document.querySelectorAll(".tabs button").forEach(b => {
    const selected = b.dataset.tab === name;
    b.classList.toggle("on", selected); b.setAttribute("aria-selected", String(selected)); b.tabIndex = selected ? 0 : -1;
  });
  for (const p of ["graph", "page", "pending"]) $(`#pane-${p}`).hidden = p !== name;
  if (name === "graph") { ensureGraph(); requestAnimationFrame(resize); }
}
document.querySelectorAll(".tabs button").forEach(b => {
  b.onclick = () => { showTab(b.dataset.tab); saveSession(); };
  b.onkeydown = e => {
    const tabs = [...document.querySelectorAll(".tabs button")];
    let i = tabs.indexOf(b);
    if (e.key === "ArrowRight") i = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") i = (i + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = tabs.length - 1;
    else return;
    e.preventDefault(); tabs[i].focus(); tabs[i].click();
  };
});

let graphReady = false;
function ensureGraph() {
  if (graphReady || !DB.nodes.length) return;
  graphReady = true;
  initGraph($("#cy"), { onOpen: id => openPage(id), onSelect: showCard });
}

// ---------------------------------------------------------------- 节点卡片
function showCard(id) {
  const card = $("#ncard");
  if (!id) { card.hidden = true; return; }
  const n = DB.nodeById[id], c = DB.byUid[id];
  let html = "";
  if (c) {
    const s = liveState(c);
    const days = s.status === "未截止" ? `剩 <b>${s.days_left}</b> 天` : s.status;
    const acc = c.acc.length ? c.acc.map(a => `${a.y}: ${a.r != null ? (a.r * 100).toFixed(1) + "%" : "—"}`).join(" · ") : "暂无";
    html = `<h3>${esc(c.abbr)} <span class="tag ${c.ccf}">CCF-${c.ccf}</span></h3>
      <div class="kv muted">${esc(c.full)}</div>
      <div class="kv">${esc(c.topic)}</div>
      <div class="kv">正文截稿（北京）<b>${esc(s.dl || "待公布")}</b> · ${days}</div>
      <div class="kv">${esc(c.place || "地点待公布")} · 到场：${esc(c.onsite)}</div>
      <div class="kv">新人条款：${esc(c.nb_status)}${c.nb_hard ? "（硬性）" : ""} · 录用率 ${esc(acc)}</div>`;
  } else if (n) {
    const deg = DB.edges.filter(e => e.s === id || e.t === id).length;
    html = `<h3>${esc(n.label)}</h3><div class="kv muted">${n.type === "direction" ? "CCF 方向" : "概念"} · 关联 ${deg} 个会议</div>`;
  }
  html += `<div class="acts"><button type="button" class="ghost sm" data-act="open">打开页面</button>
    <button type="button" class="ghost sm" data-act="ask">问 AI</button></div>`;
  card.innerHTML = html;
  card.hidden = false;
  card.querySelector('[data-act="open"]').onclick = () => openPage(id);
  card.querySelector('[data-act="ask"]').onclick = () => prefill(id);
}

function prefill(id) {
  const c = DB.byUid[id];
  const t = c ? `${c.abbr} 2027 首投需要注意什么？还来得及吗？` : `「${DB.pages[id]?.title}」相关的会议有哪些？对首投者有什么影响？`;
  $("#input").value = t;
  showView("chat");
  $("#input").focus();
  saveSession();
}

// ---------------------------------------------------------------- 页面查看
const pageHist = [];
let curPage = null;
function showLibrary() {
  if (!loaded) return;
  curPage = null;
  const q = $("#p-search").value.trim().toLowerCase();
  const results = DB.confs.filter(c => `${c.abbr} ${c.full} ${c.dir} ${c.topic}`.toLowerCase().includes(q));
  $("#page").innerHTML = `<div class="library-title"><h2>会议资料</h2><span>${results.length} 个会议</span><a href="dashboard.html${q ? "#q=" + encodeURIComponent(q) : ""}" target="_blank" rel="noopener">在倒计时看板中筛选 ↗</a><a href="#index" class="wl" data-id="index">知识库目录</a></div>` +
    (results.length ? `<div class="conference-list">${results.map(c => {
      const s = liveState(c);
      const status = s.status === "未截止" ? (s.days_left === 0 ? "不足 1 天" : `剩 ${s.days_left} 天`) : s.status === "TBD" ? "截稿待公布" : s.status;
      // same urgency scale as the dashboard: ≤30 days red, ≤90 amber, beyond that green
      const tone = s.status !== "未截止" ? "" : s.days_left <= 30 ? "open urgent" : s.days_left <= 90 ? "open warn" : "open";
      return `<button type="button" class="conference-item" data-page="${esc(c.uid)}"><span><b>${esc(c.abbr)}</b> <span class="tag ${esc(c.ccf)}">${c.ccf === "N" ? "非 CCF" : `CCF-${esc(c.ccf)}`}</span><small>${esc(c.dir)}</small></span><span class="deadline ${tone}">${esc(status)}<small>${esc(s.dl || "")}</small></span></button>`;
    }).join("")}</div>` : `<div class="empty">没有找到“${esc(q)}”，试试会议简称或研究方向。<br><button type="button" class="link" id="reset-search">清除搜索</button></div>`);
  $("#page").querySelectorAll("[data-page]").forEach(b => b.onclick = () => openPage(b.dataset.page));
  if ($("#reset-search")) $("#reset-search").onclick = () => { $("#p-search").value = ""; showLibrary(); saveSession(); };
  $("#p-back").disabled = !pageHist.length;
  $("#p-locate").hidden = $("#p-ask").hidden = true;
}
function openPage(id, push = true) {
  const pid = resolveId(id);
  if (!pid) return;
  if (push && curPage !== pid) pageHist.push(curPage || "@library");
  curPage = pid;
  const p = DB.pages[pid];
  let md = p.md;
  let fm = "";
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (m) {
    md = md.slice(m[0].length);
    const FM = { ccf: "CCF", direction: "方向", vstatus: "核查", confidence: "置信度", nb_status: "新人条款",
      gap: "缺口", count: "会议数", members: "适用会议", updated: "更新" };
    fm = m[1].split("\n").map(l => l.match(/^(\w+):\s*(.*)$/)).filter(x => x && FM[x[1]])
      .map(([, k, v]) => `<span>${esc(FM[k])}：${esc(v)}</span>`).join("");
  }
  let live = "";
  const c = DB.byUid[pid];
  if (c) {
    const s = liveState(c);
    live = `<div class="live">按当前时间（北京 ${nowBJText()}）：<b>${esc(s.status)}</b>` +
      (s.dl ? ` · ${esc(s.round)} 正文截稿 <b>${esc(s.dl)}</b>` : "") +
      (s.days_left != null ? ` · 剩 <b>${s.days_left}</b> 天` : "") + `</div>`;
  }
  let html = renderMd(md.replace(/〔([^〕]+)〕/g, (_, t) => `<span class="prov${/核查|重查/.test(t) ? " ok" : ""}">〔${esc(t)}〕</span>`));
  $("#page").innerHTML = (fm ? `<div class="fm">${fm}</div>` : "") + html.replace(/(<\/h1>)/, `$1${live}`);
  $("#page").scrollTop = 0;
  $("#p-back").disabled = !pageHist.length;
  $("#p-locate").hidden = $("#p-ask").hidden = false;
  $("#p-ask").textContent = c ? `问 ${c.abbr}` : "问相关问题";
  showTab("page");
  showView("library");
  saveSession();
}
$("#p-back").onclick = () => { const id = pageHist.pop(); if (id === "@library") { showLibrary(); saveSession(); } else if (id) openPage(id, false); };
$("#p-index").onclick = () => { $("#p-search").value = ""; showLibrary(); saveSession(); };
$("#p-search").oninput = () => { showLibrary(); saveSession(); };
$("#p-locate").onclick = () => { if (curPage) { showTab("graph"); setTimeout(() => focus(curPage), 50); showCard(curPage); } };
$("#p-ask").onclick = () => curPage && prefill(curPage);

document.addEventListener("click", e => {
  const a = e.target.closest("a.wl");
  if (!a) return;
  e.preventDefault();
  openPage(a.dataset.id);
});

// ---------------------------------------------------------------- 图工具栏
function searchGraph() {
  const q = $("#gsearch").value.trim();
  const id = q && findNode(q);
  $("#g-feedback").textContent = id ? `已定位：${DB.pages[id]?.title || q}` : q ? "没有找到，试试会议简称或方向名称。" : "输入会议简称或方向名称后查找。";
  if (id) showCard(id);
}
$("#gsearch").addEventListener("keydown", e => { if (e.key === "Enter") searchGraph(); });
$("#g-search").onclick = searchGraph;
const tog = () => applyToggles({ concept: $("#t-concept").checked, colo: $("#t-colo").checked, dense: $("#t-dense").checked });
["#t-concept", "#t-colo", "#t-dense"].forEach(s => ($(s).onchange = tog));
$("#g-fit").onclick = fitAll;
$("#g-clear").onclick = () => { clearHighlight(); showCard(null); };

// ---------------------------------------------------------------- 待审
function renderPending() {
  const items = Pending.list();
  const open = items.filter(x => x.state === "待审").length;
  const badge = $("#pending-count");
  badge.textContent = items.length;
  badge.classList.toggle("has", open > 0);
  const list = $("#pend-list");
  if (!items.length) { list.innerHTML = `<div class="empty">暂无待审修改</div>`; }
  else {
    list.innerHTML = items.slice().reverse().map(x => {
      const c = DB.byUid[x.uid];
      const old = c ? (x.field === "author_limit" ? c.al : c[x.field] ?? "") : "";
      return `<div class="pitem ${esc(x.state)}" data-id="${esc(x.id)}">
        <div class="ph"><b><a href="#" class="wl" data-id="${esc(x.uid)}">${esc(x.abbr)}</a> · ${esc(x.field)}</b>
          <span class="muted">${esc(x.state)} · ${esc(new Date(x.created).toLocaleString())}</span></div>
        <div class="diff">${old ? `<span class="old">${esc(old)}</span> → ` : ""}<span class="new">${esc(x.value)}</span></div>
        ${x.quote ? `<blockquote>${esc(x.quote)}</blockquote>` : ""}
        <div class="muted">出处：<a href="${esc(safeExternalUrl(x.evidence_url) || "#")}" target="_blank" rel="noopener noreferrer">${esc(x.evidence_url)}</a></div>
        <div class="acts">
          <button type="button" class="ghost sm" data-act="采纳">采纳</button>
          <button type="button" class="ghost sm" data-act="驳回">驳回</button>
          <button type="button" class="ghost sm" data-act="删除">删除</button>
        </div></div>`;
    }).join("");
    list.querySelectorAll(".pitem").forEach(el => el.querySelectorAll("[data-act]").forEach(b => (b.onclick = () => {
      const act = b.dataset.act;
      if (act === "删除") Pending.remove(el.dataset.id); else Pending.update(el.dataset.id, { state: act });
      renderPending();
    })));
  }
  const repo = Settings.get("repo");
  const approved = items.filter(x => x.state === "采纳");
  $("#pend-export").disabled = $("#pend-copy").disabled = !approved.length;
  const issue = $("#pend-issue");
  issue.hidden = !(/^[\w.-]+\/[\w.-]+$/.test(repo) && approved.length);
  if (!issue.hidden) {
    issue.href = `https://github.com/${repo}/issues/new`;
  }
}
const approvedJSON = () => JSON.stringify(Pending.list().filter(x => x.state === "采纳"), null, 1);
$("#pend-export").onclick = () => {
  const blob = new Blob([approvedJSON()], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "pending.json" });
  a.click(); URL.revokeObjectURL(a.href);
};
$("#pend-copy").onclick = async () => {
  try { await navigator.clipboard.writeText(approvedJSON()); $("#pend-copy").textContent = "已复制"; }
  catch { $("#pend-copy").textContent = "复制失败"; }
  setTimeout(() => ($("#pend-copy").textContent = "复制已采纳"), 1500);
};

// ---------------------------------------------------------------- 设置
function refreshBanner() { $("#banner").hidden = sharedMode() || !!Settings.get("stepKey"); }
function refreshSettingsMode() {
  const personal = $("#settings-form").elements.mode.value === "personal";
  $("#personal-settings").hidden = !personal;
  $("#personal-settings").querySelectorAll("input").forEach(el => el.disabled = !personal);
  $("#mode-description").textContent = personal ? "使用自己的 Step Key；Key 仅在当前页面内存中保留。" : "网站提供问答服务，无需填写 Key。问题及近期对话会发送给 Step；勾选联网核查后才会使用 DeepSeek。";
}
function openSettings() {
  const f = $("#settings-form");
  for (const [k, v] of Object.entries(Settings.all())) if (f.elements[k]) f.elements[k].value = v;
  $("#settings-msg").textContent = "";
  refreshSettingsMode();
  $("#dlg-settings").showModal();
}
$("#btn-settings").onclick = openSettings;
$("#banner-set").onclick = openSettings;
$("#settings-form").elements.mode.onchange = refreshSettingsMode;
$("#dlg-settings").addEventListener("close", () => {
  if ($("#dlg-settings").returnValue !== "save") return;
  const f = $("#settings-form");
  for (const k of ["mode", "baseUrl", "model", "stepKey", "deepseekKey", "repo"]) if (!f.elements[k].disabled) Settings.set(k, f.elements[k].value.trim());
  refreshBanner(); renderPending(); refreshServiceStatus();
});
$("#settings-test").onclick = async () => {
  const f = $("#settings-form"), msg = $("#settings-msg");
  msg.textContent = "测试中…";
  if (f.elements.mode.value !== "personal") {
    try {
      const health = await serviceHealth();
      msg.textContent = health.ready ? `问答服务 ✓ · ${health.search ? "联网查询 ✓" : "联网暂不可用"}` : "问答服务暂时不可用，请稍后再试";
    } catch { msg.textContent = "暂时无法连接，请稍后再试"; }
    return;
  }
  const out = [];
  try {
    const r = await fetch(modelBaseUrl(f.elements.baseUrl.value.trim()) + "/chat/completions", {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { Authorization: `Bearer ${f.elements.stepKey.value.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: f.elements.model.value.trim(), messages: [{ role: "user", content: "ping" }], max_tokens: 5, reasoning_effort: "low" }),
    });
    out.push(r.ok ? "模型 ✓" : `模型 ✗ ${r.status}`);
  } catch (e) { out.push("模型 ✗ " + e.message); }
  const dk = f.elements.deepseekKey.value.trim();
  if (dk) {
    try {
      const r = await fetch("https://api.deepseek.com/v1/tools/search", {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { Authorization: `Bearer ${dk}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ICLR 2027 call for papers", count: 1 }),
      });
      out.push(r.ok ? "联网 ✓" : `联网 ✗ ${r.status}`);
    } catch (e) { out.push("联网 ✗ " + e.message); }
  } else out.push("未配置联网");
  msg.textContent = out.join(" · ");
};
$("#effort").value = Settings.get("effort");
$("#effort").onchange = e => Settings.set("effort", e.target.value);
$("#allow-web").onchange = e => { Settings.set("allowWeb", String(e.target.checked)); refreshServiceStatus(); };

// ---------------------------------------------------------------- 对话
const EFFORT_CN = {low:"快速回答",medium:"标准回答",high:"深入分析",xhigh:"深入分析"};
async function refreshServiceStatus() {
  const status = $("#service-status");
  const web = Settings.get("allowWeb") === "true";
  if (!sharedMode()) { status.textContent = Settings.get("stepKey") ? `个人服务 · ${web && Settings.get("deepseekKey") ? "已允许联网" : "仅知识库"}` : "个人服务 · 请先填写 Key"; return; }
  status.textContent = "正在连接网站服务…";
  try { const h = await serviceHealth(); if (!sharedMode()) return; status.textContent = h.ready ? `网站服务 · ${web && h.search ? "已允许联网核查" : "仅知识库"}` : "网站服务暂不可用，可先浏览会议资料"; }
  catch { if (sharedMode()) status.textContent = "暂时无法连接，可稍后重试或先查会议资料"; }
}
window.addEventListener("online", refreshServiceStatus);
window.addEventListener("offline", () => { $("#service-status").textContent = "网络已断开，已加载的会议资料仍可浏览"; });
const TOOL_CN = { search_wiki: "检索知识库", read_index: "读目录", read_page: "读页面", graph_neighbors: "沿图多跳",
  filter_conferences: "筛选会议", web_search: "联网搜索", web_fetch: "抓取网页", propose_update: "提交待审" };

function summarize(name, a, r) {
  if (r?.error) return "✗ " + r.error.slice(0, 80);
  switch (name) {
    case "search_wiki": return `命中 ${r.results.length}：${r.results.slice(0, 5).map(x => x.title).join("、")}`;
    case "read_index": return r.count != null ? `${r.count} 行` : "全目录";
    case "read_page": return r.live ? `${r.id}（${r.live.status}${r.live.days_left != null ? "，剩 " + r.live.days_left + " 天" : ""}）` : r.id;
    case "graph_neighbors": return `${r.center} 周边 ${r.total} 个节点`;
    case "filter_conferences": return `符合 ${r.total} 个：${r.results.slice(0, 6).map(x => x.abbr).join("、")}${r.total > 6 ? "…" : ""}`;
    case "web_search": return `${r.results.length} 条结果`;
    case "web_fetch": return `${r.title || r.url}（${(r.content || "").length} 字）`;
    case "propose_update": return "已加入待审区";
    default: return "";
  }
}
function argText(a) {
  return Object.entries(a).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : String(v).slice(0, 60)}`).join(" ");
}

function addMsg(cls, html) {
  $("#welcome").hidden = true;
  const el = document.createElement("div");
  el.className = "msg " + cls;
  el.innerHTML = html;
  $("#msgs").appendChild(el);
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
  return el;
}

function setBusy(b) {
  const btn = $("#btn-send");
  btn.textContent = b ? "停止" : "发送";
  btn.classList.toggle("stop", b);
  btn.type = b ? "button" : "submit";
  btn.onclick = b ? e => { e.preventDefault(); controller?.abort(); } : null;
  $("#btn-clear").disabled = b;
  $("#input").setAttribute("aria-busy", String(b));
  $("#allow-web").disabled = b;
}

function answerActions(foot, turn) {
  foot.replaceChildren();
  const button = (label, action) => { const b = document.createElement("button"); b.type = "button"; b.className = "ghost sm"; b.textContent = label; b.onclick = action; foot.append(b); return b; };
  if (turn.status === "done") {
    const copy = button("复制回答", async () => { try { await navigator.clipboard.writeText(turn.answer); copy.textContent = "已复制"; } catch { copy.textContent = "请选中回答复制"; } });
    if (turn.visited?.length) button(`查看引用关系（${turn.visited.length}）`, () => { showView("library"); showTab("graph"); requestAnimationFrame(() => highlightPath(new Map(turn.visited))); });
  } else button("重新提问", () => { $("#input").value = turn.question; showView("chat"); $("#input").focus(); saveSession(); });
  if (turn.seconds) { const timing = document.createElement("span"); timing.textContent = `用时 ${turn.seconds} 秒`; foot.append(timing); }
}

function restoreConversation() {
  for (const turn of turns) {
    addMsg("user", "").textContent = turn.question;
    if (turn.status === "working") { turn.status = "stopped"; turn.answer = "上次回答尚未完成，可以重新提问。"; }
    const el = addMsg("ai", `<div class="body md"></div><div class="foot"></div>`);
    el.querySelector(".body").innerHTML = renderMd(turn.answer || "回答未完成，可以重新提问。");
    answerActions(el.querySelector(".foot"), turn);
  }
}

async function send(text) {
  text = text.trim();
  if (!text || controller) return;
  if (!sharedMode() && !Settings.get("stepKey")) { openSettings(); return; }
  const u = addMsg("user", "");
  u.textContent = text;
  $("#input").value = "";
  $("#hint").textContent = "Enter 发送 · Shift+Enter 换行";
  const turn = {question:text, answer:"", status:"working", visited:[]};
  turns.push(turn); if (turns.length > 12) turns.shift(); saveSession();
  const el = addMsg("ai", `<div class="meta"></div>
    <div class="answer-status" role="status">正在准备回答…</div>
    <details class="proc"><summary>查询记录</summary><ol></ol></details>
    <div class="body md cursor"></div><div class="foot"></div>`);
  const meta = el.querySelector(".meta"), proc = el.querySelector(".proc"), ol = proc.querySelector("ol");
  const body = el.querySelector(".body"), foot = el.querySelector(".foot");
  const status = el.querySelector(".answer-status");
  let buf = "", steps = 0, curStep = -1, raf = 0;
  const paint = () => { raf = 0; const msgs = $("#msgs"); const follow = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 100; body.innerHTML = renderMd(buf); if (follow) msgs.scrollTop = msgs.scrollHeight; };
  controller = new AbortController();
  setBusy(true);
  const t0 = performance.now();
  let phase = "正在查阅资料";
  const timer = setInterval(() => { status.textContent = `${phase} · 已用 ${Math.round((performance.now()-t0)/1000)} 秒`; }, 1000);
  try {
    const res = await ask(history, text, {
      signal: controller.signal,
      onRoute: r => { meta.innerHTML = `<span class="chip ${r.effort}">${esc(EFFORT_CN[r.effort] || "标准回答")}</span>${r.effort === "high" ? "<span>多条件分析通常需要更长时间</span>" : ""}`; },
      onStep: s => { curStep = s; buf = ""; body.innerHTML = ""; phase = "正在整理资料"; },
      onDelta: (d, s) => {
        if (d.content && s === curStep) { phase = "正在生成回答"; buf += d.content; if (!raf) raf = requestAnimationFrame(paint); }
      },
      onToolStart: (name, a) => {
        steps++;
        buf = ""; body.innerHTML = "";
        phase = TOOL_CN[name] || "正在查询";
        const li = document.createElement("li");
        li.innerHTML = `<span class="tn">${esc(TOOL_CN[name] || name)}</span> <span class="muted">${esc(argText(a))}</span> <span class="tr">…</span>`;
        ol.appendChild(li);
        proc.querySelector("summary").textContent = `查询记录 · ${steps} 项`;
      },
      onToolEnd: (name, a, r) => { ol.lastElementChild.querySelector(".tr").textContent = "→ " + summarize(name, a, r); },
      onPending: () => renderPending(),
    });
    if (raf) cancelAnimationFrame(raf);
    body.classList.remove("cursor");
    body.innerHTML = renderMd(res.text || "暂未生成回答，请重新提问。");
    proc.hidden = !steps;
    proc.querySelector("summary").textContent = `查询记录 · ${steps} 项`;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    Object.assign(turn, {answer:res.text || "暂未生成回答，请重新提问。", status:res.text ? "done" : "error", visited:[...res.visited], seconds:secs});
    if (res.text) history.push({ role: "user", content: text }, { role: "assistant", content: res.text });
    if (res.visited.size && matchMedia("(min-width: 901px)").matches && !$("#pane-graph").hidden) highlightPath(res.visited);
  } catch (e) {
    body.classList.remove("cursor");
    turn.status = e.name === "AbortError" ? "stopped" : "error";
    const reason = /failed to fetch|networkerror|load failed/i.test(e.message || "") ? "连接中断，请检查网络后重新提问。" : e.message || "连接失败，请稍后重试";
    turn.answer = e.name === "AbortError" ? (buf ? `${buf}\n\n*回答已停止，以上内容尚未完成。*` : "已停止回答。可以修改问题后重新发送。") : `暂时未能完成回答：${reason}`;
    body.innerHTML = renderMd(turn.answer);
    proc.hidden = !steps;
  } finally {
    clearInterval(timer); if (raf) cancelAnimationFrame(raf);
    status.hidden = true;
    answerActions(foot, turn);
    controller = null;
    setBusy(false);
    saveSession();
  }
}

$("#composer").addEventListener("submit", e => { e.preventDefault(); send($("#input").value); });
$("#input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($("#input").value); }
});
$("#input").addEventListener("input", e => {
  const v = e.target.value.trim();
  $("#hint").textContent = v ? `${v.length} / 4000 字 · ${EFFORT_CN[Settings.get("effort") === "auto" ? routeEffort(v).effort : Settings.get("effort")]}` : "Enter 发送 · Shift+Enter 换行";
  saveSession();
});
$("#btn-clear").onclick = () => { if (controller) return; history.length = 0; turns.length = 0; Pending.clear(); renderPending(); clearSession(); $("#msgs").querySelectorAll(".msg").forEach(el => el.remove()); $("#welcome").hidden = false; $("#input").value = ""; $("#hint").textContent = "Enter 发送 · Shift+Enter 换行"; clearHighlight(); saveSession(); $("#input").focus(); };

const EXAMPLES = [
  "ICLR 2027 首投有什么坑？现在还来得及吗？",
  "我做联邦学习里的隐私保护，学生一作，想投三个月内截稿、最好能远程参会的 B 类以上会议，帮我列候选。",
  "S&P 第二轮还来得及吗？同一作者能投几篇？",
  "哪些会要求作者登记当审稿人？对只有学生作者的论文有豁免吗？",
];

// ---------------------------------------------------------------- 启动
(async () => {
  refreshBanner();
  refreshServiceStatus();
  try {
    await loadWiki();
  } catch (e) {
    $("#sub").textContent = "会议资料暂时加载失败，请刷新页面重试。";
    $("#btn-send").disabled = true;
    return;
  }
  loaded = true;
  const n = DB.confs.length;
  $("#sub").textContent = `2027 投稿指南 · ${n} 个会议 · 截稿时间按北京时间显示`;
  $("#examples").innerHTML = EXAMPLES.map(t => `<button type="button">${esc(t)}</button>`).join("");
  $("#examples").querySelectorAll("button").forEach(b => (b.onclick = () => { $("#input").value = b.textContent; $("#input").focus(); saveSession(); }));
  renderPending();
  $("#input").value = typeof saved.draft === "string" ? saved.draft.slice(0,4000) : "";
  $("#p-search").value = typeof saved.query === "string" ? saved.query : "";
  restoreConversation(); showLibrary();
  showTab(["graph","page","pending"].includes(saved.tab) ? saved.tab : "page");
  showView(saved.view === "library" ? "library" : "chat");
  if (saved.page && resolveId(saved.page)) { const view = activeView, tab = activeTab; openPage(saved.page, false); showTab(tab); showView(view); }
  function followHash() {
    let hash = ""; try { hash = decodeURIComponent(location.hash.slice(1)); } catch {}
    if (hash && resolveId(hash)) openPage(hash);
    if (hash === "library" || hash === "chat") { showView(hash); if (hash === "library") { showTab("page"); showLibrary(); } }
    if (hash) window.history.replaceState(null,"",location.pathname + location.search);
    saveSession();
  }
  window.addEventListener("hashchange", followHash);
  followHash();
  saveSession();
})();

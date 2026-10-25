import { DB, loadWiki, liveState, resolveId, nowBJText } from "./data.js";
import { ask, routeEffort } from "./agent.js";
import { Settings, Pending } from "./store.js";
import { initGraph, applyToggles, focus, highlightPath, clearHighlight, findNode, fitAll, resize } from "./graph.js";

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- Markdown
DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") || "")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
marked.use({ gfm: true, breaks: false });

function wikiLinks(text) {
  // 表格里模型会把 | 转义成 \|，如 [[pldi27\|PLDI]]
  return text.replace(/\[\[([^\]|\\]+)\\?(?:\|([^\]]+))?\]\]/g, (_, id, label) => {
    const pid = resolveId(id.trim());
    const title = label || (pid && DB.pages[pid]?.title) || id;
    return `<a href="#${esc(pid || id)}" class="wl${pid ? "" : " missing"}" data-id="${esc(pid || id)}">${esc(title)}</a>`;
  });
}
function renderMd(text) {
  return DOMPurify.sanitize(marked.parse(wikiLinks(text || "")));
}

// ---------------------------------------------------------------- 标签页
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  for (const p of ["graph", "page", "pending"]) $(`#pane-${p}`).hidden = p !== name;
  if (name === "graph") { ensureGraph(); requestAnimationFrame(resize); }
}
document.querySelectorAll(".tabs button").forEach(b => (b.onclick = () => showTab(b.dataset.tab)));

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
  $("#input").focus();
}

// ---------------------------------------------------------------- 页面查看
const pageHist = [];
let curPage = null;
function openPage(id, push = true) {
  const pid = resolveId(id);
  if (!pid) return;
  if (push && curPage && curPage !== pid) pageHist.push(curPage);
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
  let html = renderMd(md);
  html = html.replace(/〔([^〕]+)〕/g, (_, t) => `<span class="prov${/核查|重查/.test(t) ? " ok" : ""}">〔${t}〕</span>`);
  $("#page").innerHTML = (fm ? `<div class="fm">${fm}</div>` : "") + html.replace(/(<\/h1>)/, `$1${live}`);
  $("#page").scrollTop = 0;
  $("#p-back").disabled = !pageHist.length;
  showTab("page");
}
$("#p-back").onclick = () => { const id = pageHist.pop(); if (id) openPage(id, false); };
$("#p-index").onclick = () => openPage("index");
$("#p-locate").onclick = () => { if (curPage) { showTab("graph"); setTimeout(() => focus(curPage), 50); showCard(curPage); } };
$("#p-ask").onclick = () => curPage && prefill(curPage);

document.addEventListener("click", e => {
  const a = e.target.closest("a.wl");
  if (!a) return;
  e.preventDefault();
  openPage(a.dataset.id);
});

// ---------------------------------------------------------------- 图工具栏
$("#gsearch").addEventListener("keydown", e => {
  if (e.key === "Enter") { const id = findNode(e.target.value.trim()); if (id) showCard(id); }
});
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
        <div class="muted">出处：<a href="${esc(x.evidence_url)}" target="_blank" rel="noopener noreferrer">${esc(x.evidence_url)}</a></div>
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
  const issue = $("#pend-issue");
  issue.hidden = !(repo && approved.length);
  if (!issue.hidden) {
    const body = "待审修改（来自 CCF 会议助手），审核后运行 `python apply_pending.py pending.json`：\n\n```json\n" +
      JSON.stringify(approved, null, 1) + "\n```";
    issue.href = `https://github.com/${repo}/issues/new?labels=pending-review&title=${encodeURIComponent(`[待审] ${approved.length} 条知识库修改`)}&body=${encodeURIComponent(body).slice(0, 7000)}`;
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
function refreshBanner() { $("#banner").hidden = !!Settings.get("stepKey"); }
function openSettings() {
  const f = $("#settings-form");
  for (const [k, v] of Object.entries(Settings.all())) if (f.elements[k]) f.elements[k].value = v;
  $("#settings-msg").textContent = "";
  $("#dlg-settings").showModal();
}
$("#btn-settings").onclick = openSettings;
$("#banner-set").onclick = openSettings;
$("#dlg-settings").addEventListener("close", () => {
  if ($("#dlg-settings").returnValue !== "save") return;
  const f = $("#settings-form");
  for (const k of ["baseUrl", "model", "stepKey", "deepseekKey", "repo"]) Settings.set(k, f.elements[k].value.trim());
  refreshBanner(); renderPending();
});
$("#settings-test").onclick = async () => {
  const f = $("#settings-form"), msg = $("#settings-msg");
  msg.textContent = "测试中…";
  const out = [];
  try {
    const r = await fetch(f.elements.baseUrl.value.trim().replace(/\/+$/, "") + "/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${f.elements.stepKey.value.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: f.elements.model.value.trim(), messages: [{ role: "user", content: "ping" }], max_tokens: 5, reasoning_effort: "low" }),
    });
    out.push(r.ok ? "模型 ✓" : `模型 ✗ ${r.status}`);
  } catch (e) { out.push("模型 ✗ " + e.message); }
  const dk = f.elements.deepseekKey.value.trim();
  if (dk) {
    try {
      const r = await fetch("https://api.deepseek.com/v1/tools/search", {
        method: "POST", headers: { Authorization: `Bearer ${dk}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ICLR 2027 call for papers", count: 1 }),
      });
      out.push(r.ok ? "联网 ✓" : `联网 ✗ ${r.status}`);
    } catch (e) { out.push("联网 ✗ " + e.message); }
  } else out.push("未配置联网");
  msg.textContent = out.join(" · ");
};
$("#effort").value = Settings.get("effort");
$("#effort").onchange = e => Settings.set("effort", e.target.value);

// ---------------------------------------------------------------- 对话
const history = [];
let controller = null;
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
  $("#welcome")?.remove();
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
  btn.onclick = b ? () => controller?.abort() : null;
}

async function send(text) {
  text = text.trim();
  if (!text || controller) return;
  if (!Settings.get("stepKey")) { openSettings(); return; }
  const u = addMsg("user", "");
  u.textContent = text;
  $("#input").value = "";
  const el = addMsg("ai", `<div class="meta"></div>
    <details class="proc"><summary>准备中…</summary><ol></ol><details class="think-wrap" hidden><summary class="muted" style="padding:0 12px">思考过程</summary><div class="think"></div></details></details>
    <div class="body md cursor"></div><div class="foot"></div>`);
  const meta = el.querySelector(".meta"), proc = el.querySelector(".proc"), ol = proc.querySelector("ol");
  const body = el.querySelector(".body"), foot = el.querySelector(".foot");
  const think = el.querySelector(".think"), thinkWrap = el.querySelector(".think-wrap");
  let buf = "", steps = 0, curStep = -1, raf = 0;
  const paint = () => { raf = 0; body.innerHTML = renderMd(buf); $("#msgs").scrollTop = $("#msgs").scrollHeight; };
  controller = new AbortController();
  setBusy(true);
  const t0 = performance.now();
  try {
    const res = await ask(history, text, {
      signal: controller.signal,
      onRoute: r => { meta.innerHTML = `<span class="chip ${r.effort}">推理 ${r.effort}</span><span>${esc(r.why)}</span>`; },
      onStep: s => { curStep = s; buf = ""; body.innerHTML = ""; },
      onDelta: (d, s) => {
        if (d.reasoning) { thinkWrap.hidden = false; think.textContent += d.reasoning; }
        if (d.content && s === curStep) { buf += d.content; if (!raf) raf = requestAnimationFrame(paint); }
      },
      onToolStart: (name, a) => {
        steps++;
        // 本轮在调工具前输出的文字算过程，不算回答
        if (buf.trim()) { const li = document.createElement("li"); li.className = "muted"; li.textContent = buf.trim().slice(0, 200); ol.appendChild(li); }
        buf = ""; body.innerHTML = "";
        const li = document.createElement("li");
        li.innerHTML = `<span class="tn">${esc(TOOL_CN[name] || name)}</span> <span class="muted">${esc(argText(a))}</span> <span class="tr">…</span>`;
        ol.appendChild(li);
        proc.querySelector("summary").textContent = `过程 · ${steps} 次工具调用`;
      },
      onToolEnd: (name, a, r) => { ol.lastElementChild.querySelector(".tr").textContent = "→ " + summarize(name, a, r); },
      onPending: () => renderPending(),
    });
    if (raf) cancelAnimationFrame(raf);
    body.classList.remove("cursor");
    body.innerHTML = renderMd(res.text || "（模型没有给出回答，请换个问法或调高推理等级）");
    proc.querySelector("summary").textContent = steps ? `过程 · ${steps} 次工具调用` : "过程 · 直接回答";
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    foot.innerHTML = `<button type="button" class="ghost sm" data-act="path">在图中看推理路径（${res.visited.size} 个节点）</button>
      <span>${secs}s · tokens ${res.usage.prompt}/${res.usage.completion}</span>`;
    foot.querySelector('[data-act="path"]').onclick = () => { showTab("graph"); setTimeout(() => highlightPath(res.visited), 60); };
    history.push({ role: "user", content: text }, { role: "assistant", content: res.text || "" });
    if (res.visited.size && matchMedia("(min-width: 901px)").matches && !$("#pane-graph").hidden) highlightPath(res.visited);
  } catch (e) {
    body.classList.remove("cursor");
    if (e.name === "AbortError") body.innerHTML = renderMd((buf || "") + "\n\n*（已停止）*");
    else { body.innerHTML = ""; addMsg("err", esc(e.message || String(e))); }
  } finally {
    controller = null;
    setBusy(false);
  }
}

$("#composer").addEventListener("submit", e => { e.preventDefault(); send($("#input").value); });
$("#input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($("#input").value); }
});
$("#input").addEventListener("input", e => {
  const v = e.target.value.trim();
  $("#hint").textContent = v ? `预计推理等级：${routeEffort(v).effort}` : "Enter 发送 · Shift+Enter 换行";
});
$("#btn-clear").onclick = () => { history.length = 0; $("#msgs").innerHTML = ""; clearHighlight(); };

const EXAMPLES = [
  "ICLR 2027 首投有什么坑？现在还来得及吗？",
  "我做联邦学习里的隐私保护，学生一作，想投三个月内截稿、最好能远程参会的 B 类以上会议，帮我列候选。",
  "S&P 第二轮还来得及吗？同一作者能投几篇？",
  "哪些会要求作者登记当审稿人？对只有学生作者的论文有豁免吗？",
];

// ---------------------------------------------------------------- 启动
(async () => {
  refreshBanner();
  try {
    await loadWiki();
  } catch (e) {
    $("#sub").textContent = e.message + "（本地预览请用 python -m http.server 打开 site/ 目录）";
    return;
  }
  const n = DB.confs.length;
  $("#sub").textContent = `知识库 ${n} 个会议 · ${DB.counts.pages} 页 · ${DB.counts.edges} 条关系 · 生成于 ${DB.generated}（北京）`;
  $("#examples").innerHTML = EXAMPLES.map(t => `<button type="button">${esc(t)}</button>`).join("");
  $("#examples").querySelectorAll("button").forEach(b => (b.onclick = () => { $("#input").value = b.textContent; send(b.textContent); }));
  renderPending();
  ensureGraph();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && resolveId(hash)) openPage(hash);
})();

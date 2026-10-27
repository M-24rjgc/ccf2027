// 宣传片时间轴（约 62 秒）。所有画面都由 seek(t) 按时间计算（没有 CSS 动画），逐帧截图即可得到确定的视频。
// 画面里的数字与文字来自 site/js/dashboard-data.js（会议数据）和 promo/out/facts.js（知识库规模 + 真实 Agent 运行记录）。
"use strict";
const DURATION = 62;
const $ = s => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  out: k => 1 - Math.pow(1 - k, 3),
  in: k => k * k * k,
  inOut: k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  back: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
};
const prog = (t, a, b, e = E.out) => e(clamp((t - a) / (b - a)));
function css(el, {x = 0, y = 0, s = 1, r = 0, o = 1}) {
  el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)}) rotate(${r.toFixed(2)}deg)`;
  el.style.opacity = o.toFixed(3);
}
// rise in during [a, a+d], fade out during [b, b+d2]
function show(el, t, a, b = 99, {d = .5, dy = 34, d2 = .35, dyOut = -24, s0 = 1, x0 = 0} = {}) {
  const i = prog(t, a, a + d), o = prog(t, b, b + d2, E.in);
  css(el, {x: (1 - i) * x0, y: (1 - i) * dy + o * dyOut, s: lerp(s0, 1, i), o: i * (1 - o)});
}
function scene(el, t, a, b, fin = .3, fout = .35) {
  const o = (a <= 0 ? 1 : prog(t, a, a + fin, E.inOut)) * (1 - prog(t, b - fout, b, E.inOut));
  el.style.opacity = o.toFixed(3);
  el.style.visibility = o > 0.001 ? "visible" : "hidden";
  return o > 0.001;
}
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);

// ---------------------------------------------------------------- real data
const C = window.CCF_DASH.confs, META = window.CCF_DASH.meta, F = window.FACTS;
const byUid = Object.fromEntries(C.map(c => [c.uid, c]));
const count = (arr, f) => arr.filter(f).length;
const STATS = [C.length, count(C, c => c.vs === "已核实"), count(C, c => c.nbs === "有专属条款"), count(C, c => c.acc.length)];
const NB_HARD = count(C, c => c.nbs === "有专属条款" && c.nb.startsWith("硬性"));
$("#s1-n").textContent = C.length;
$("#s2-aoe").textContent = META.aoe;
$("#s2-shift").textContent = META.shifted;
$("#s8-dirs").textContent = window.CCF_DASH.dirs.length;
// official deadline vs. Beijing time, straight from merged.json (raw_dl / full_dl)
const TZ = [
  {abbr: "CVPR", raw: "11-16 23:59", tz: "UTC−12（AoE 同口径）", bj: "11-17 19:59"},
  {abbr: "VLDB", raw: "11-01 17:00", tz: "PT · 美国太平洋时间", bj: "11-02 09:00"},
  {abbr: "OSDI", raw: "12-08 22:59", tz: "UTC", bj: "12-09 06:59"},
];
const A = F.agent;
const QUESTION = A.question;
// only name the tools this run actually used
$("#s4-sub").textContent = [...new Set(A.steps.map(s => s.tool))].join(" · ") + ` · 共 ${A.steps.length} 次调用`;

// ---------------------------------------------------------------- background network (seeded, deterministic)
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const NODES = Array.from({length: 38}, () => ({x: rnd() * 2100 - 90, y: rnd() * 1240 - 80, r: 2 + rnd() * 4.5, ph: rnd() * 6.28, sp: .25 + rnd() * .4, gold: rnd() < .14}));
const EDGES = [];
NODES.forEach((a, i) => NODES.map((b, j) => ({j, d: Math.hypot(a.x - b.x, a.y - b.y)})).filter(e => e.j > i && e.d < 330).sort((p, q) => p.d - q.d).slice(0, 3).forEach(e => EDGES.push([i, e.j])));
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const net = $("#bg-net");
const edgeEls = EDGES.map(() => svgEl("line", {stroke: "rgba(255,255,255,.16)", "stroke-width": 1.2}, net));
const nodeEls = NODES.map(n => svgEl("circle", {r: n.r, fill: n.gold ? "#F2B84B" : "rgba(255,255,255,.7)"}, net));
function background(t) {
  $("#bg-dots").style.transform = `translate(${(-t * 7).toFixed(1)}px, ${(-t * 3.5).toFixed(1)}px)`;
  const pos = NODES.map(n => [n.x + Math.sin(t * n.sp + n.ph) * 22 - t * 4, n.y + Math.cos(t * n.sp * .8 + n.ph) * 16]);
  pos.forEach((p, i) => { nodeEls[i].setAttribute("cx", p[0].toFixed(1)); nodeEls[i].setAttribute("cy", p[1].toFixed(1)); });
  EDGES.forEach(([a, b], i) => { const l = edgeEls[i]; l.setAttribute("x1", pos[a][0].toFixed(1)); l.setAttribute("y1", pos[a][1].toFixed(1)); l.setAttribute("x2", pos[b][0].toFixed(1)); l.setAttribute("y2", pos[b][1].toFixed(1)); });
  // strong on the intro/outro, quiet behind screenshots and diagrams
  const strong = Math.max(1 - prog(t, 3.4, 4.4, E.inOut), prog(t, 57.6, 58.6, E.inOut));
  const mid = Math.max(prog(t, 3.6, 4.4) * (1 - prog(t, 7.6, 8.4)), prog(t, 53.6, 54.4) * (1 - prog(t, 57.6, 58.4)));
  net.style.opacity = (Math.max(.12, strong * .62, mid * .32)).toFixed(3);
}

// ---------------------------------------------------------------- browser frame with camera + spotlight
function makeFrame(host, url, images, W = 1360) {
  const H = Math.round(W * 900 / 1440);
  host.innerHTML = `<div class="frame" style="width:${W}px;height:${H + 44}px">
    <div class="bar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i><div class="url">${url}</div></div>
    <div class="content" style="width:${W}px;height:${H}px">
      <div class="screen">${images.map(s => `<img src="assets/${s}" alt="">`).join("")}<div class="typed" style="display:none"><p></p></div></div>
      <div class="spot" style="opacity:0"></div><div class="spot-label" style="opacity:0"></div>
    </div></div>`;
  const q = s => host.querySelector(s);
  return {W, H, frame: q(".frame"), content: q(".content"), screen: q(".screen"), imgs: [...host.querySelectorAll(".screen img")], spot: q(".spot"), label: q(".spot-label"), typed: q(".typed"), cx: 720, cy: 450, S: W / 1440};
}
// keyframes: each key starts moving toward its pose at `at`, over `d` seconds
function track(keys, t, props) {
  const cur = {...keys[0]};
  for (const k of keys.slice(1)) {
    if (t < k.at) break;
    const e = E.inOut(clamp((t - k.at) / (k.d || .8)));
    for (const p of props) cur[p] = lerp(cur[p], k[p], e);
  }
  return cur;
}
function camera(Fr, keys, t) {
  const c = track(keys, t, ["cx", "cy", "z"]);
  Fr.cx = c.cx; Fr.cy = c.cy; Fr.S = Fr.W / 1440 * c.z;
  Fr.screen.style.transform = `translate(${(Fr.W / 2 - c.cx * Fr.S).toFixed(2)}px, ${(Fr.H / 2 - c.cy * Fr.S).toFixed(2)}px) scale(${Fr.S.toFixed(4)})`;
}
const local = (Fr, x, y) => [Fr.W / 2 + (x - Fr.cx) * Fr.S, Fr.H / 2 + (y - Fr.cy) * Fr.S];
function spotlight(Fr, segments, t) {
  const seg = segments.find(s => t >= s.keys[0].at - .05 && t < s.off + .4);
  if (!seg) { Fr.spot.style.opacity = 0; Fr.label.style.opacity = 0; return; }
  const ks = seg.keys.map(k => ({at: k.at, d: .45, x: k.r[0], y: k.r[1], w: k.r[2], h: k.r[3]}));
  const r = track(ks, t, ["x", "y", "w", "h"]);
  const vis = prog(t, ks[0].at, ks[0].at + .35) * (1 - prog(t, seg.off, seg.off + .3, E.in));
  const [lx, ly] = local(Fr, r.x, r.y), lw = r.w * Fr.S, lh = r.h * Fr.S;
  Object.assign(Fr.spot.style, {left: `${lx.toFixed(1)}px`, top: `${ly.toFixed(1)}px`, width: `${lw.toFixed(1)}px`, height: `${lh.toFixed(1)}px`, opacity: vis.toFixed(3)});
  let i = 0; seg.keys.forEach((k, j) => { if (t >= k.at) i = j; });
  const k = seg.keys[i], next = seg.keys[i + 1];
  if (Fr.label.textContent !== k.label) Fr.label.textContent = k.label;
  const lo = prog(t, k.at + .2, k.at + .5) * (next ? 1 - prog(t, next.at - .12, next.at + .02) : 1) * vis;
  const w = Fr.label.offsetWidth, h = Fr.label.offsetHeight;
  let top = ly + lh + 18;
  if (top + h > Fr.H - 14) top = ly - h - 18;
  if (top < 14) top = ly + 18;
  const left = clamp(lx + lw / 2 - w / 2, 18, Fr.W - w - 18);
  Object.assign(Fr.label.style, {left: `${left.toFixed(1)}px`, top: `${top.toFixed(1)}px`, opacity: lo.toFixed(3),
    transform: `translateY(${((1 - prog(t, k.at + .2, k.at + .5)) * 10).toFixed(1)}px)`});
}
function crossfade(Fr, windows, t, fade = .4) { // windows[i] = [in, out] seconds for image i
  Fr.imgs.forEach((img, i) => {
    const [a, b] = windows[i] || [99, 99];
    img.style.opacity = (prog(t, a, a + fade, E.inOut) * (1 - prog(t, b, b + fade, E.inOut))).toFixed(3);
  });
}

// ---------------------------------------------------------------- scene 2 rows
const ROWS = TZ.map((r, i) => {
  const row = document.createElement("div"); row.className = "tzrow"; row.style.top = `${360 + i * 130}px`;
  row.innerHTML = `<div class="badge a" style="left:235px">${r.abbr}</div>
    <div class="chip raw a" style="left:445px"><b>${r.raw}</b><span>${r.tz}</span></div>
    <div class="arrow a" style="left:937px;width:112px"></div>
    <div class="chip bj a" style="left:1075px"><b>${r.bj}</b><span>北京时间</span></div>
    <div class="plus a" style="left:1568px">+1 天</div>`;
  $("#s2-rows").appendChild(row);
  const q = s => row.querySelector(s);
  return {badge: q(".badge"), raw: q(".raw"), arrow: q(".arrow"), bj: q(".bj"), plus: q(".plus")};
});

// ---------------------------------------------------------------- scene 3 · dashboard
const F3 = makeFrame($("#s3-fw"), "m-24rjgc.github.io/ccf2027/dashboard.html", ["dash.png", "dash-drawer.png"]);
const CAM3 = [
  {at: 0, cx: 720, cy: 450, z: 1},
  {at: 8.6, cx: 720, cy: 440, z: 1.025, d: 2.8},
  {at: 11.55, cx: 976, cy: 292, z: 1.55, d: .9},
  {at: 13.55, cx: 976, cy: 608, z: 1.55, d: .7},
  {at: 14.3, cx: 720, cy: 450, z: 1, d: .8},
];
const SPOT3 = [
  {keys: [
    {at: 8.95, r: [18, 310, 700, 172], label: "还能投 · 30 天内 · 待公布，一眼分清"},
    {at: 9.85, r: [722, 310, 700, 172], label: "未来 16 周截稿分布，点柱子按周筛选"},
    {at: 10.75, r: [466, 578, 262, 132], label: "不足 3 天精确到小时，红点提醒"},
  ], off: 11.4},
  {keys: [
    {at: 12.45, r: [954, 154, 472, 160], label: "精确到秒的倒计时，摘要截止单独提醒"},
    {at: 13.75, r: [952, 842, 210, 54], label: "官网直达 · 一键加入日历"},
  ], off: 14.2},
];

// ---------------------------------------------------------------- scene 4 · the real agent run
// time-lapse: one frame per new tool-call count, then the streaming answer
const RUN = [];
{ let last = -1; const max = Math.max(...A.frames.map(f => f.steps));
  for (const f of A.frames) if (f.chars < 50 && f.steps !== last) { RUN.push(f); last = f.steps; }
  for (const f of A.frames) if (f.steps === max && f.chars >= 50) RUN.push(f); }
const TL0 = 17.95, TL1 = 22.0, TLstep = (TL1 - TL0) / RUN.length;
const F4 = makeFrame($("#s4-fw"), "m-24rjgc.github.io/ccf2027/", ["chat-empty.png", ...RUN.map(f => "agent/" + f.file), "agent/answer-0.png", "agent/answer-1.png", "agent/answer-2.png"]);
const badge = document.createElement("div"); badge.className = "tl-badge"; badge.style.opacity = 0; F4.content.appendChild(badge);
const W4 = [[0, 17.9], ...RUN.map((f, i) => [TL0 + i * TLstep, i === RUN.length - 1 ? 22.0 : TL0 + (i + 1) * TLstep]), [22.0, 23.7], [23.7, 25.9], [25.9, 99]];
const CAM4 = [
  {at: 0, cx: 720, cy: 450, z: 1},
  {at: 16.35, cx: 515, cy: 600, z: 1.5, d: .8},
  {at: 17.8, cx: 515, cy: 430, z: 1.45, d: .6},
  {at: 21.9, cx: 515, cy: 450, z: 1.4, d: .5},
];
const SPOT4 = [
  {keys: [
    {at: 22.25, r: [26, 226, 300, 34], label: `推荐类问题，自动切到「${A.route}」`},
    {at: 22.95, r: [30, 256, 618, 424], label: `${A.steps.length} 次工具调用，每一步都可展开查看`},
  ], off: 23.55},
  {keys: [
    {at: 23.95, r: [28, 330, 624, 72], label: "先给结论，再按推荐度排"},
    {at: 24.75, r: [44, 548, 608, 30], label: "能否远程：引用官网核查的字段"},
  ], off: 25.6},
  {keys: [{at: 26.15, r: [28, 306, 626, 100], label: "没核实的字段，会注明〔知识补全〕"}], off: 27.6},
];

// ---------------------------------------------------------------- scene 5 · reasoning chain (stage-native) + real graph
const TOOL_CLASS = {"筛选会议": "filter", "检索知识库": "search", "读页面": "read"};
const traceBox = $("#trace");
const STEP_T0 = 28.45, STEP_DT = .17;
// readable one-liners of the real tool calls (arguments translated, nothing invented)
const ARG_CN = {ccf: v => `CCF ${v}`, deadline_to: v => `截稿≤${v}`, deadline_from: v => `截稿≥${v}`, min_days: v => `至少剩 ${v} 天`,
  within_days: v => `剩≤${v} 天`, exclude_onsite_required: () => "排除必须到场", exclude_newbie_hard: () => "排除新人硬性条款",
  keywords: v => `关键词 ${v.split("/").slice(0, 3).join("/")}…`, status: () => ""};
function stepText(s) {
  if (s.tool === "读页面") {
    const id = (s.args || "").replace("id=", ""), n = A.graph.nodes.find(x => x.id === id);
    const st = (s.result.match(/（(.+)）/) || [])[1];
    return n?.type === "direction" ? `「${n.label}」方向页` : `${n ? n.label : id} 会议页${st ? `（${st}）` : ""}`;
  }
  if (s.tool === "检索知识库") return `“${(s.args || "").replace("query=", "")}”  →  ${s.result.split("：")[0]}`;
  const args = (s.args || "").split(" ").map(kv => { const [k, v] = kv.split("="); return ARG_CN[k] ? ARG_CN[k](v || "") : ""; }).filter(Boolean).join(" · ");
  return `${args}  →  ${s.result.split("：")[0].replace("符合 ", "")}`;
}
const traceRows = A.steps.map((s, i) => {
  const row = document.createElement("div"); row.className = "tstep"; row.style.top = `${i * 46}px`; row.style.opacity = 0;
  const what = stepText(s);
  row.innerHTML = `<span class="n">${i + 1}</span><span class="tool ${TOOL_CLASS[s.tool] || "read"}">${esc(s.tool)}</span><span class="what">${esc(what)}</span>`;
  traceBox.appendChild(row);
  return row;
});
// verdict per conference, from the answer's own sections
const VERDICT = {};
A.sections.forEach((sec, i) => sec.ids.forEach(id => { VERDICT[id] = i <= 1 ? "pick" : i === 2 ? "onsite" : "watch"; }));
const VCOLOR = {pick: "#F2B84B", onsite: "#7DB2E3", watch: "#6B7C91"};
// layout: question → directions → conferences → clauses
const G = A.graph;
const gnodes = Object.fromEntries(G.nodes.map(n => [n.id, {...n}]));
const dirs = G.nodes.filter(n => n.type === "direction").map(n => n.id);
const concepts = G.nodes.filter(n => n.type === "concept").map(n => n.id);
const dirOf = id => (G.edges.find(e => e.s === id && dirs.includes(e.t)) || {}).t;
const confs = G.nodes.filter(n => n.type === "conference").map(n => n.id)
  .sort((a, b) => ((dirs.indexOf(dirOf(a)) + 1) || 9) - ((dirs.indexOf(dirOf(b)) + 1) || 9));
const QX = 870, DX = 1095, KX = 1385, CX = 1680;
gnodes.q = {id: "q", label: "你的问题", type: "question", x: QX, y: 560};
dirs.forEach((id, i) => Object.assign(gnodes[id], {x: DX, y: 560 + (i - (dirs.length - 1) / 2) * 175}));
confs.forEach((id, i) => Object.assign(gnodes[id], {x: KX, y: 560 + (i - (confs.length - 1) / 2) * 61}));
concepts.forEach((id, i) => Object.assign(gnodes[id], {x: CX, y: 560 + (i - (concepts.length - 1) / 2) * 190}));
// when each node lights up: the step that first touched it, else at the answer
const ANSWER_T = STEP_T0 + A.steps.length * STEP_DT + .15, CLAUSE_T = ANSWER_T + .35, VERDICT_T = CLAUSE_T + .55;
gnodes.q.rt = 28.25;
A.steps.forEach((s, i) => s.nodes.forEach(id => { if (gnodes[id] && gnodes[id].rt === undefined) gnodes[id].rt = STEP_T0 + i * STEP_DT + .05; }));
confs.forEach(id => { if (gnodes[id].rt === undefined) gnodes[id].rt = ANSWER_T; });
dirs.forEach(id => { if (gnodes[id].rt === undefined) gnodes[id].rt = ANSWER_T; });
concepts.forEach((id, i) => { gnodes[id].rt = CLAUSE_T + i * .08; });
// edges: question→direction (found by search), direction↔conference and conference→clause (real wiki links)
const chainSvg = $("#chain");
const gEdges = svgEl("g", {}, chainSvg), gNodes = svgEl("g", {}, chainSvg);
const LINKS = [];
const curve = (a, b) => { const mx = (a.x + b.x) / 2; return `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`; };
const addLink = (a, b, at, kind) => {
  const p = svgEl("path", {d: curve(a, b), fill: "none", stroke: kind === "clause" ? "rgba(181,155,224,.55)" : "rgba(160,190,225,.55)", "stroke-width": 2}, gEdges);
  const len = p.getTotalLength(); p.setAttribute("stroke-dasharray", `${len} ${len}`);
  LINKS.push({p, len, at, a: a.id, b: b.id, kind});
};
dirs.forEach(id => addLink(gnodes.q, gnodes[id], gnodes[id].rt, "dir"));
G.edges.forEach(e => {
  const s = gnodes[e.s], t2 = gnodes[e.t];
  if (dirs.includes(e.t)) addLink(t2, s, Math.max(s.rt, t2.rt), "conf");
  else if (concepts.includes(e.t)) addLink(s, t2, CLAUSE_T + .05 + concepts.indexOf(e.t) * .08, "clause");
});
confs.filter(id => !dirOf(id)).forEach(id => addLink(gnodes.q, gnodes[id], gnodes[id].rt, "conf")); // reached by filtering, not via a direction page
const NODE_EL = {};
for (const n of Object.values(gnodes)) {
  const g = svgEl("g", {class: "gnode"}, gNodes);
  if (n.type === "question") {
    svgEl("rect", {x: n.x - 92, y: n.y - 36, width: 184, height: 72, rx: 36, fill: "#F2B84B"}, g);
    svgEl("text", {x: n.x, y: n.y + 10, "text-anchor": "middle", "font-size": 28, "font-weight": 700, fill: "#14223A"}, g).textContent = n.label;
  } else if (n.type === "direction") {
    const w = n.label.length * 25 + 40;
    svgEl("rect", {x: n.x - w / 2, y: n.y - 26, width: w, height: 52, rx: 10, fill: "#1F3552", stroke: "rgba(255,255,255,.35)", "stroke-width": 1.5}, g);
    svgEl("text", {x: n.x, y: n.y + 9, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: "#fff"}, g).textContent = n.label;
  } else if (n.type === "conference") {
    const w = Math.max(110, n.label.length * 15 + 56);
    n.w = w;
    const ring = svgEl("rect", {x: n.x - w / 2 - 5, y: n.y - 26, width: w + 10, height: 52, rx: 26, fill: "none", stroke: "#F2B84B", "stroke-width": 4, opacity: 0}, g);
    svgEl("rect", {x: n.x - w / 2, y: n.y - 21, width: w, height: 42, rx: 21, fill: "#EEF2F7"}, g);
    svgEl("circle", {cx: n.x - w / 2 + 20, cy: n.y, r: 7, fill: {A: "#C0392B", B: "#D68A1C", C: "#2D6A9F"}[n.ccf] || "#98A2AE"}, g);
    svgEl("text", {x: n.x - w / 2 + 36, y: n.y + 8, "font-size": 22, "font-weight": 700, fill: "#14223A"}, g).textContent = n.label;
    n.ring = ring;
  } else {
    svgEl("rect", {x: n.x - 11, y: n.y - 11, width: 22, height: 22, fill: "#B59BE0", transform: `rotate(45 ${n.x} ${n.y})`}, g);
    svgEl("text", {x: n.x + 24, y: n.y + 9, "font-size": 23, "font-weight": 700, fill: "#E3D9F5"}, g).textContent = n.label;
  }
  NODE_EL[n.id] = g;
}
$("#chain-legend").innerHTML = [["pick", "推荐候选"], ["onsite", "能到场再考虑"], ["watch", "观察 / 已截止"]]
  .map(([k, l]) => `<span><i style="background:${VCOLOR[k]}"></i>${l}</span>`).join("") + `<span><i style="background:#B59BE0;border-radius:3px;transform:rotate(45deg) scale(.8)"></i>核对的条款</span>`;
function chain(t) {
  traceRows.forEach((row, i) => { const a = STEP_T0 + i * STEP_DT; css(row, {x: (1 - prog(t, a, a + .25)) * -24, o: prog(t, a, a + .25) * (1 - .45 * prog(t, VERDICT_T, VERDICT_T + .4))}); });
  for (const n of Object.values(gnodes)) {
    const el = NODE_EL[n.id], k = prog(t, n.rt, n.rt + .3, E.back);
    const dim = n.type === "conference" && VERDICT[n.id] === "watch" ? .5 * prog(t, VERDICT_T, VERDICT_T + .4) : 0;
    el.setAttribute("opacity", (clamp(prog(t, n.rt, n.rt + .2)) * (1 - dim)).toFixed(3));
    el.setAttribute("transform", `translate(${n.x} ${n.y}) scale(${(.6 + .4 * clamp(k, 0, 1.2)).toFixed(3)}) translate(${-n.x} ${-n.y})`);
    if (n.ring) {
      const v = VERDICT[n.id];
      n.ring.setAttribute("stroke", VCOLOR[v] || "transparent");
      n.ring.setAttribute("opacity", (v && v !== "watch" ? prog(t, VERDICT_T, VERDICT_T + .35) : 0).toFixed(3));
    }
  }
  for (const L of LINKS) {
    const k = prog(t, L.at, L.at + .35, E.inOut);
    L.p.setAttribute("stroke-dashoffset", (L.len * (1 - k)).toFixed(1));
    const watch = VERDICT[L.a] === "watch" || VERDICT[L.b] === "watch";
    L.p.setAttribute("opacity", (k > 0 ? 1 - (watch ? .6 * prog(t, VERDICT_T, VERDICT_T + .4) : 0) : 0).toFixed(3));
  }
  show($("#chain-legend"), t, VERDICT_T, 99, {dy: 14});
  show($("#trace-cap"), t, 28.2, 99, {dy: 10});
}
const F5 = makeFrame($("#s5-fw"), "m-24rjgc.github.io/ccf2027/", ["agent/graph-path.png"]);
const CAM5 = [
  {at: 0, cx: 975, cy: 560, z: 1.55},
  {at: 35.2, cx: 1163, cy: 628, z: 2.6, d: .8},  // network & security cluster
  {at: 36.25, cx: 1040, cy: 300, z: 2.6, d: .8}, // AI cluster
];
const SPOT5 = [{keys: [
  {at: 34.4, r: [690, 210, 736, 670], label: `回答引用的 ${A.visited} 个节点，在图上高亮`},
  {at: 35.3, r: [1196, 566, 186, 124], label: "网络与信息安全：S&P · PETS · DSN · USENIX Security"},
  {at: 36.35, r: [952, 228, 168, 132], label: "人工智能：ACL · IJCAI · ICLR · COLT"},
], off: 37.5}];

// ---------------------------------------------------------------- scene 6 · wiki
const F6 = makeFrame($("#s6-fw"), "m-24rjgc.github.io/ccf2027/", ["concept.png", "page.png"], 1040);
const RR = F.concepts["reciprocal-review"];
const CAM6 = [{at: 0, cx: 906, cy: 520, z: 1.38}, {at: 40.95, cx: 906, cy: 560, z: 1.38, d: .6}];
const SPOT6 = [
  {keys: [
    {at: 38.85, r: [688, 188, 560, 68], label: `一个概念页「${RR.label}」`},
    {at: 39.7, r: [690, 402, 720, 390], label: `串起 ${RR.members} 个会议，各自链接到会议页`},
  ], off: 40.65},
  {keys: [{at: 41.35, r: [688, 496, 712, 330], label: "每个字段标注出处：官网核查 / 知识补全"}], off: 43.4},
];
const TY = F.wiki.types;
$("#s6-chips").innerHTML = [[TY.conference, "会议页"], [TY.direction, "方向页"], [TY.concept, "概念页"], [TY.meta, "目录页"]]
  .map(([n, l]) => `<span>${n} ${l}</span>`).join("");

// ---------------------------------------------------------------- scene 7 · newbie clauses, on-site, caps, review mode
const CARD_UIDS = ["iclr27", "cvpr27", "chi27", "pldi27", "cidr27", "imc27"];
const CARDS = CARD_UIDS.map((uid, i) => {
  const d = byUid[uid], [kind, text] = d.nb.split("｜");
  const el = document.createElement("div"); el.className = "card a";
  el.style.left = `${120 + (i % 3) * 570}px`; el.style.top = `${232 + Math.floor(i / 3) * 236}px`;
  el.innerHTML = `<div class="top"><b>${esc(d.abbr)}</b><span class="ccf ${d.ccf}">CCF-${d.ccf}</span><span class="kind ${kind === "硬性" ? "hard" : "perk"}">${esc(kind)}</span></div><p>${esc(text)}</p>`;
  $("#cards").appendChild(el);
  return el;
});
$("#s7-c1").innerHTML = `<span class="y">${STATS[2]}</span> 个会议标注了新人作者条款，其中 <span class="y">${NB_HARD}</span> 个是硬性要求 · 「无专属条款」是查过确实没有`;
const cats = ["reciprocal-review", "submission-cap", "orcid", "reserve-reviewer", "student-support"].map(id => F.concepts[id]);
const catRow = document.createElement("div"); catRow.className = "a chips"; catRow.id = "s7-cats"; catRow.style.cssText = "left:120px;top:735px;width:1700px";
catRow.innerHTML = `<span style="background:none;border:0;padding-left:0;color:#9FB1C7">按类别归档：</span>` + cats.map(c => `<span>${esc(c.label)} · <b style="color:#F2B84B">${c.members}</b></span>`).join("");
$("#s7").appendChild(catRow);
function statRow(el, title, note, parts) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  el.innerHTML = `<div class="t">${title}<span>${note}</span></div><div class="sbar">${parts.map(p => `<div style="flex:${p.n};background:${p.c}"></div>`).join("")}</div>
    <div class="slab">${parts.map(p => `<span><i style="background:${p.c}"></i>${p.l} <b>${p.n}</b></span>`).join("")}</div>`;
  return {bars: [...el.querySelectorAll(".sbar div")], total};
}
const ON = statRow($("#row-onsite"), "到场要求", `${C.length} 个会议`, [
  {l: "必须到场", n: count(C, c => c.onsite === "必须到场"), c: "#5C93C9"},
  {l: "允许远程", n: count(C, c => c.onsite === "允许远程"), c: "#6CC891"},
  {l: "待确认（官网未写明）", n: count(C, c => !["必须到场", "允许远程"].includes(c.onsite)), c: "rgba(255,255,255,.24)"}]);
const BL = statRow($("#row-blind"), "评审方式", "双盲 / 单盲", [
  {l: "双盲", n: count(C, c => c.blind === "双盲"), c: "#5C93C9"},
  {l: "单盲", n: count(C, c => c.blind === "单盲"), c: "#B59BE0"},
  {l: "待确认", n: count(C, c => !["双盲", "单盲"].includes(c.blind)), c: "rgba(255,255,255,.24)"}]);
const CAPS = C.filter(c => c.aln).sort((a, b) => a.aln - b.aln || a.abbr.localeCompare(b.abbr));
const ladder = []; for (const c of CAPS) if (!ladder.some(x => x.aln === c.aln)) ladder.push(c);
$("#row-cap").innerHTML = `<div class="t">投稿篇数上限<span>${CAPS.length} 个会议明文限篇，按每位作者计</span></div>
  <div class="ladder">${ladder.slice(0, 5).map(c => `<span><b>${c.aln} 篇</b>${esc(c.abbr)}</span>`).join("")}</div>`;
const LADDER = [...$("#row-cap").querySelectorAll(".ladder span")];
const inset = $("#s7-inset"), insetImg = inset.querySelector("img"), insetSpot = inset.querySelector(".spot");
const IS = 690 / 500; // show the drawer column (x 940–1440 of the 1440-wide page)
Object.assign(insetImg.style, {width: `${1440 * IS}px`, left: `${-940 * IS}px`, top: `${-150 * IS}px`});
const INSET_SPOTS = [
  {at: 50.75, r: [952, 338, 476, 56]},   // 到场要求 + 远程参会
  {at: 51.9, r: [952, 516, 476, 76]},    // 新人作者条款
];

// ---------------------------------------------------------------- the timeline
function seek(t) {
  background(t);
  $("#fade").style.opacity = Math.max(1 - prog(t, 0, .5, E.inOut), prog(t, DURATION - .7, DURATION, E.inOut)).toFixed(3);

  // 1 · intro (0–4)
  if (scene($("#s1"), t, 0, 4.05)) {
    $("#s1").style.transform = `scale(${(1 + t * .008).toFixed(4)})`;
    const lg = $("#logo"), pin = prog(t, .2, .85, E.back), out = prog(t, 3.5, 4, E.in);
    css(lg, {s: lerp(.55, 1, pin), y: -out * 30, o: prog(t, .2, .5) * (1 - out)});
    const e = $("#logo-e"); e.setAttribute("stroke-dasharray", "40"); e.setAttribute("stroke-dashoffset", (40 * (1 - prog(t, .5, 1.15, E.inOut))).toFixed(2));
    [["#logo-n1", 3.2, .6], ["#logo-n2", 2.4, .72], ["#logo-n3", 3.6, .84]].forEach(([id, r, a]) => $(id).setAttribute("r", (r * clamp(E.back(clamp((t - a) / .4)), 0, 2)).toFixed(3)));
    show($("#s1-title"), t, 1.0, 3.5, {dy: 40});
    show($("#s1-sub"), t, 1.3, 3.55);
    [...$("#s1-pills").children].forEach((p, i) => show(p, t, 1.75 + i * .12, 3.6 + i * .03, {dy: 24, s0: .9}));
  }

  // 2 · time zones (4–8)
  if (scene($("#s2"), t, 3.95, 8.05)) {
    show($("#s2-title"), t, 4.05, 7.6);
    show($("#s2-l"), t, 4.35, 7.6, {dy: 14}); show($("#s2-r"), t, 5.2, 7.6, {dy: 14});
    ROWS.forEach((r, i) => {
      const a = 4.35 + i * .13, b = 5.15 + i * .13;
      show(r.badge, t, a, 7.62, {dy: 0, x0: -60});
      show(r.raw, t, a + .05, 7.62, {dy: 0, x0: -80});
      const ar = prog(t, b, b + .35, E.inOut);
      r.arrow.style.transform = `scaleX(${ar.toFixed(3)})`; r.arrow.style.opacity = (Math.min(1, ar * 3) * (1 - prog(t, 7.62, 7.95))).toFixed(3);
      show(r.bj, t, b + .2, 7.65, {dy: 0, x0: 80});
      show(r.plus, t, b + .55, 7.66, {dy: 0, s0: .4, d: .45});
      r.raw.style.opacity = (Number(r.raw.style.opacity) * (1 - .45 * prog(t, b + .3, b + .7))).toFixed(3);
    });
    show($("#s2-cap"), t, 6.3, 7.6);
  }

  // 3 · dashboard (8–16)
  if (scene($("#s3"), t, 7.95, 16.05)) {
    show($("#s3-h1"), t, 8.05, 11.45, {dy: 20});
    show($("#s3-h2"), t, 11.65, 14.2, {dy: 20});
    show($("#s3-h3"), t, 14.4, 15.7, {dy: 20});
    // 2D only: a 3D tilt over large screenshots is very slow to composite in headless capture
    const ent = prog(t, 7.95, 8.85), shrink = prog(t, 14.3, 15.1, E.inOut), leave = prog(t, 15.65, 16.05, E.in);
    css(F3.frame, {y: (1 - ent) * 160 - leave * 30, x: -shrink * 205, s: lerp(.9, 1, ent) * lerp(1, .86, shrink), o: ent * (1 - leave)});
    crossfade(F3, [[0, 11.6], [11.6, 99]], t);
    camera(F3, CAM3, t);
    spotlight(F3, SPOT3, t);
    const ph = prog(t, 14.55, 15.3);
    css($("#s3-phone"), {x: (1 - ph) * 420, y: (1 - ph) * 40 - leave * 30, r: (1 - ph) * 7, o: ph * (1 - leave)});
  }

  // 4 · agent (16–28)
  if (scene($("#s4"), t, 15.95, 28.05)) {
    show($("#s4-h1"), t, 16.05, 17.7, {dy: 20});
    show($("#s4-h2"), t, 17.9, 21.85, {dy: 20});
    show($("#s4-h3"), t, 22.05, 27.6, {dy: 20});
    const ent = prog(t, 15.95, 16.7), leave = prog(t, 27.65, 28.05, E.in);
    css(F4.frame, {x: (1 - ent) * 220, s: lerp(.94, 1, ent), y: -leave * 30, o: ent * (1 - leave)});
    crossfade(F4, W4, t, .14);
    F4.imgs[0].style.opacity = (1 - prog(t, 17.9, 18.04)).toFixed(3);
    camera(F4, CAM4, t);
    spotlight(F4, SPOT4, t);
    const typing = clamp((t - 16.55) / 1.15), n = Math.round(typing * [...QUESTION].length);
    F4.typed.style.display = t > 16.3 && t < 18.1 ? "block" : "none";
    const caret = typing < 1 || Math.floor(t * 2.6) % 2 === 0 ? '<i class="caret"></i>' : "";
    F4.typed.querySelector("p").innerHTML = esc([...QUESTION].slice(0, n).join("")) + caret;
    // time-lapse badge: the speed-up while it plays, then the real total the app reported
    badge.innerHTML = t < TL1 ? `<i></i>延时摄影 · 约 <b>${Math.round(A.seconds / (TL1 - TL0))}</b> 倍速` : `<i></i>实际用时 <b>${A.seconds}</b> 秒`;
    badge.style.opacity = (prog(t, TL0 + .05, TL0 + .3) * (1 - prog(t, 23.2, 23.5))).toFixed(3);
  }

  // 5 · reasoning chain (28–33) + real graph (33–38)
  if (scene($("#s5"), t, 27.95, 38.05)) {
    show($("#s5-h1"), t, 28.05, 33.5, {dy: 20});
    show($("#s5-h2"), t, 33.75, 37.6, {dy: 20});
    const ca = 1 - prog(t, 33.5, 33.85, E.in);
    $("#s5a").style.opacity = ca.toFixed(3);
    $("#s5a").style.visibility = ca > 0 ? "visible" : "hidden";
    if (ca > 0) chain(t);
    const ent = prog(t, 33.6, 34.3), leave = prog(t, 37.65, 38.05, E.in);
    css(F5.frame, {y: (1 - ent) * 120 - leave * 30, s: lerp(.92, 1, ent), o: ent * (1 - leave)});
    crossfade(F5, [[0, 99]], t);
    camera(F5, CAM5, t);
    spotlight(F5, SPOT5, t);
  }

  // 6 · wiki (38–44)
  if (scene($("#s6"), t, 37.95, 44.05)) {
    show($("#s6-k"), t, 38.05, 43.6, {dy: 14});
    show($("#s6-h"), t, 38.15, 43.62, {dy: 24});
    show($("#s6-n1"), t, 38.45, 43.64, {dy: 30});
    show($("#s6-n2"), t, 38.65, 43.66, {dy: 30});
    $("#s6-n1 span").textContent = Math.round(F.wiki.pages * prog(t, 38.45, 39.6));
    $("#s6-n2 span").textContent = Math.round(F.wiki.edges * prog(t, 38.65, 39.8));
    show($("#s6-chips"), t, 39.25, 43.68, {dy: 18});
    show($("#s6-note"), t, 39.7, 43.7, {dy: 18});
    const ent = prog(t, 38.1, 38.8), leave = prog(t, 43.65, 44.05, E.in);
    css(F6.frame, {x: (1 - ent) * 160, s: lerp(.94, 1, ent), y: -leave * 30, o: ent * (1 - leave)});
    crossfade(F6, [[0, 40.95], [40.95, 99]], t);
    camera(F6, CAM6, t);
    spotlight(F6, SPOT6, t);
  }

  // 7 · details (44–54)
  if (scene($("#s7"), t, 43.95, 54.05)) {
    show($("#s7-h1"), t, 44.05, 48.6, {dy: 20});
    show($("#s7-c1"), t, 44.3, 48.6, {dy: 14});
    CARDS.forEach((el, i) => show(el, t, 44.5 + i * .14, 48.55 + i * .02, {dy: 50, s0: .94}));
    show($("#s7-cats"), t, 45.7, 48.65, {dy: 16});
    show($("#s7-h2"), t, 49.05, 53.6, {dy: 20});
    [[$("#row-onsite"), 49.3, ON], [$("#row-blind"), 49.75, BL]].forEach(([el, a, R]) => {
      show(el, t, a, 53.62, {dy: 24});
      let acc = 0;
      R.bars.forEach(b => { const w = prog(t, a + .25 + acc * .5, a + .55 + acc * .5, E.inOut); b.style.transform = `scaleX(${w.toFixed(3)})`; acc += 1 / R.bars.length; });
    });
    show($("#row-cap"), t, 50.2, 53.64, {dy: 24});
    LADDER.forEach((el, i) => show(el, t, 50.45 + i * .1, 99, {dy: 16, s0: .9}));
    show(inset, t, 49.5, 53.66, {dy: 0, x0: 120, s0: .96});
    show($("#s7-cap"), t, 50.4, 53.66, {dy: 12});
    const sp = track(INSET_SPOTS.map(k => ({at: k.at, d: .45, x: k.r[0], y: k.r[1], w: k.r[2], h: k.r[3]})), t, ["x", "y", "w", "h"]);
    Object.assign(insetSpot.style, {left: `${((sp.x - 940) * IS).toFixed(1)}px`, top: `${((sp.y - 150) * IS).toFixed(1)}px`, width: `${(sp.w * IS).toFixed(1)}px`, height: `${(sp.h * IS).toFixed(1)}px`,
      opacity: (prog(t, 50.75, 51.1) * (1 - prog(t, 53.3, 53.6))).toFixed(3)});
  }

  // 8 · numbers (54–58)
  if (scene($("#s8"), t, 53.95, 58.05)) {
    show($("#s8-title"), t, 54.05, 57.6);
    ["#st1", "#st2", "#st3", "#st4"].forEach((id, i) => {
      const el = $(id), a = 54.25 + i * .16;
      show(el, t, a, 57.62, {dy: 50});
      el.querySelector("b").textContent = Math.round(STATS[i] * prog(t, a, a + 1.1, E.out));
    });
    show($("#s8-cap"), t, 55.75, 57.62, {dy: 18});
  }

  // 9 · end card (58–62)
  if (scene($("#s9"), t, 57.95, DURATION + .5)) {
    $("#s9").style.transform = `scale(${(1 + (t - 58) * .006).toFixed(4)})`;
    show($("#logo2"), t, 58.1, 99, {dy: 0, s0: .6, d: .6});
    show($("#s9-title"), t, 58.35, 99, {dy: 36});
    show($("#s9-url"), t, 58.7, 99, {dy: 26, s0: .92});
    show($("#s9-tag"), t, 59.0, 99, {dy: 20});
  }
}

window.DURATION = DURATION;
window.seek = seek;
window.READY = Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode().catch(() => {}))]).then(() => { seek(0); return true; });
// preview in a normal browser: plays in real time, ?t=12 jumps to a moment
if (!navigator.webdriver && !/[?&]render/.test(location.search)) {
  const at = Number(new URLSearchParams(location.search).get("t"));
  window.READY.then(() => {
    if (!Number.isNaN(at) && location.search.includes("t=")) return seek(at);
    const t0 = performance.now();
    const loop = now => { seek(((now - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
}

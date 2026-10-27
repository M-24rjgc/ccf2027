// 倒计时看板：数据来自 js/dashboard-data.js（build_html.py 生成）。
// 不写任何浏览器存储；筛选状态放在地址栏 # 后面，可分享、可前进后退，且不会发给服务器。
"use strict";
(() => {
const {confs: DATA, dirs: DIRS, meta: META} = window.CCF_DASH;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const APP_HOME = location.pathname.endsWith("/dashboard.html") ? "index.html" : "site/index.html";
$$("a.home-link").forEach(a => { a.href = APP_HOME + (a.hash || ""); });

const DAY = 864e5, HOUR = 36e5, BJ = 8 * HOUR;
const WD = "日一二三四五六";
const CCF = ["A", "B", "C", "N"];
const ST = ["all", "open", "soon", "tbd", "closed"];
const ST_LABEL = {open: "还能投", soon: "30 天内截稿", tbd: "日期待公布", closed: "已截止"};
const WEEKS = 16;
const CAP = 14, AXIS = 20; // chart: px reserved above bars for the value, below for week labels
const bjTime = s => s ? Date.parse(s.replace(" ", "T") + ":00+08:00") : NaN;
const bjParts = t => { const d = new Date(t + BJ); return {y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes()}; };
const p2 = n => String(n).padStart(2, "0");
const ymd = t => { const p = bjParts(t); return `${p.y}-${p2(p.m)}-${p2(p.d)}`; };
const md = t => { const p = bjParts(t); return `${p.m}/${p.d}`; };
const stamp = t => { const p = bjParts(t); return `${p.y}-${p2(p.m)}-${p2(p.d)} ${p2(p.hh)}:${p2(p.mm)}`; };
const safeUrl = u => { try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password ? x.href : ""; } catch { return ""; } };
const pct = r => (r * 100).toFixed(1).replace(/\.0$/, "") + "%";

// ---------- state <-> URL hash ----------
const fresh = () => ({st: "all", ccf: new Set(), dir: new Set(), nb: false, gap: false, q: "", wk: null});
let sel = fresh();
let sort = {k: "days", dir: 1};
let openUid = null;
let drawerPushed = false;

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const s = fresh();
  if (ST.includes(p.get("st"))) s.st = p.get("st");
  (p.get("ccf") || "").split(",").filter(x => CCF.includes(x)).forEach(x => s.ccf.add(x));
  (p.get("dir") || "").split(",").filter(x => DIRS.includes(x)).forEach(x => s.dir.add(x));
  s.nb = p.get("nb") === "1"; s.gap = p.get("gap") === "1";
  s.q = (p.get("q") || "").trim().slice(0, 80);
  const wk = p.get("wk"); if (/^\d{4}-\d{2}-\d{2}$/.test(wk || "")) s.wk = wk;
  const [k, d] = (p.get("sort") || "").split(":");
  sort = Object.hasOwn(SORTS, k) ? {k, dir: d === "-1" ? -1 : 1} : {k: "days", dir: 1};
  sel = s;
  const c = p.get("c");
  return DATA.some(x => x.uid === c) ? c : null;
}
function hashFor(withConf) {
  const p = new URLSearchParams();
  if (sel.st !== "all") p.set("st", sel.st);
  if (sel.ccf.size) p.set("ccf", CCF.filter(x => sel.ccf.has(x)).join(","));
  if (sel.dir.size) p.set("dir", [...sel.dir].join(","));
  if (sel.nb) p.set("nb", "1");
  if (sel.gap) p.set("gap", "1");
  if (sel.q) p.set("q", sel.q);
  if (sel.wk) p.set("wk", sel.wk);
  if (sort.k !== "days" || sort.dir !== 1) p.set("sort", `${sort.k}:${sort.dir}`);
  if (withConf) p.set("c", withConf);
  const h = p.toString();
  return location.pathname + location.search + (h ? "#" + h : "");
}
const syncUrl = () => history.replaceState(history.state, "", hashFor(openUid));

// ---------- time-dependent fields ----------
let NOW = Date.now();
function recompute() {
  NOW = Date.now();
  for (const d of DATA) {
    const rs = d.rounds.map((x, i) => ({...x, i, t: bjTime(x.dl), ta: bjTime(x.abs)})).filter(x => x.t);
    const up = rs.filter(x => x.t > NOW).sort((a, b) => a.t - b.t);
    let m = null;
    if (up.length) { m = up[0]; d.status = "open"; }
    else if (rs.length) { m = rs.reduce((a, b) => (a.t > b.t ? a : b)); d.status = "closed"; }
    else d.status = "tbd";
    d.cur = m; d.t = m ? m.t : null;
    d.left = d.status === "open" ? m.t - NOW : null;
    d.days = d.status === "open" ? Math.floor(d.left / DAY) : null;
    d.absT = d.status === "open" && m.ta > NOW ? m.ta : null;
    d.dec = (d.rounds.length <= 1 && d.decv) || (m && m.dec) || "";
    d.accR = d.acc.length ? d.acc[d.acc.length - 1].r : null;
  }
}

// ---------- filtering & sorting ----------
const terms = () => sel.q.toLowerCase().split(/\s+/).filter(Boolean);
const hay = d => d._hay || (d._hay = [d.abbr, d.full, d.topic, d.place, d.dir, d.uid, d.date, d.sys].join(" ").toLowerCase());
function inScope(d, ts) {
  if (sel.ccf.size && !sel.ccf.has(d.ccf)) return false;
  if (sel.dir.size && !sel.dir.has(d.dir)) return false;
  if (sel.nb && d.nbs !== "有专属条款") return false;
  if (sel.gap && !d.gap) return false;
  return ts.every(t => hay(d).includes(t));
}
const wkStart = () => sel.wk ? Date.parse(sel.wk + "T00:00:00+08:00") : null;
function matchStatus(d) {
  if (sel.st === "open") return d.status === "open";
  if (sel.st === "soon") return d.status === "open" && d.days <= 30;
  if (sel.st === "tbd") return d.status === "tbd";
  if (sel.st === "closed") return d.status === "closed";
  return true;
}
function matchWeek(d) {
  const w = wkStart();
  return w === null || (d.status === "open" && d.t >= w && d.t < w + 7 * DAY);
}
const visible = () => { const ts = terms(); return DATA.filter(d => inScope(d, ts) && matchStatus(d) && matchWeek(d)); };
const GROUP = {open: 0, tbd: 1, closed: 2};
const lim = d => d.aln ?? (d.ald === "不限" ? 1e8 : 1e9);
const SORTS = {
  abbr: (a, b) => a.abbr.localeCompare(b.abbr, "en", {sensitivity: "base"}),
  ccf: (a, b) => CCF.indexOf(a.ccf) - CCF.indexOf(b.ccf),
  dir: (a, b) => DIRS.indexOf(a.dir) - DIRS.indexOf(b.dir),
  days: null, // grouped: open by time left, then TBD, then closed (most recent first)
  dec: (a, b) => (a.dec || "9999").localeCompare(b.dec || "9999"),
  aln: (a, b) => lim(a) - lim(b),
  acc: null, // conferences without data always sink to the bottom
  vs: (a, b) => a.vs.localeCompare(b.vs, "zh"),
};
function byDays(a, b) {
  return GROUP[a.status] - GROUP[b.status] || (a.status === "open" ? (a.t - b.t) * sort.dir : a.status === "closed" ? b.t - a.t : 0);
}
function compare(a, b) {
  if (sort.k === "days") return byDays(a, b) || a.idx - b.idx;
  if (sort.k === "acc") {
    if ((a.accR === null) !== (b.accR === null)) return a.accR === null ? 1 : -1;
    return ((a.accR ?? 0) - (b.accR ?? 0)) * sort.dir || byDays(a, b) || a.idx - b.idx;
  }
  return SORTS[sort.k](a, b) * sort.dir || byDays(a, b) || a.idx - b.idx;
}

// ---------- cell formatting ----------
function leftText(ms) {
  if (ms < HOUR) return {n: Math.max(1, Math.floor(ms / 6e4)), u: "分钟"};
  if (ms < DAY) return {n: Math.floor(ms / HOUR), u: "小时"};
  const dd = Math.floor(ms / DAY);
  return dd < 3 ? {n: dd, u: "天", h: Math.floor((ms % DAY) / HOUR)} : {n: dd, u: "天"};
}
const urgency = d => d.left < 3 * DAY ? "d-crit" : d.days <= 30 ? "d-urgent" : d.days <= 90 ? "d-warn" : "d-ok";
function daysCell(d) {
  if (d.status === "closed") return `<span class="off">已截止</span>`;
  if (d.status === "tbd") return `<span class="off">待公布</span>`;
  const x = leftText(d.left);
  const h = x.h !== undefined ? `${x.h}<small>小时</small>` : "";
  return `<span class="days ${urgency(d)}" title="按北京时间计算">${x.n}<small>${x.u}</small>${h}</span>`;
}
function hl(text) {
  const ts = terms(); const raw = String(text ?? "");
  if (!ts.length) return esc(raw);
  const low = raw.toLowerCase(); const marks = [];
  for (const t of ts) for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + t.length)) marks.push([i, i + t.length]);
  if (!marks.length) return esc(raw);
  marks.sort((a, b) => a[0] - b[0]);
  let out = "", pos = 0;
  for (const [s, e] of marks) {
    if (e <= pos) continue;
    const st = Math.max(s, pos);
    out += esc(raw.slice(pos, st)) + "<mark>" + esc(raw.slice(st, e)) + "</mark>"; pos = e;
  }
  return out + esc(raw.slice(pos));
}
function roundName(d) {
  const n = d.rounds.length, i = d.cur.i + 1, l = d.cur.l || "";
  return /^第\d+轮$/.test(l) || l.length > 18 ? `第 ${i} / ${n} 轮` : `${l} · ${i}/${n}`;
}
function dlCell(d) {
  if (!d.t) return `<span class="off">2027 日期待公布</span>`;
  const p = bjParts(d.t);
  let sub = "";
  if (d.absT) {
    const a = bjParts(d.absT);
    sub = `<span class="sub abs${d.absT - NOW < 7 * DAY ? " hot" : ""}" title="摘要注册截止，北京时间">摘要 ${a.m}/${a.d} ${p2(a.hh)}:${p2(a.mm)}</span>`;
  } else if (d.rounds.length > 1) {
    sub = `<span class="sub" title="${esc(d.cur.l)}">${esc(roundName(d))}</span>`;
  }
  return `<span class="date">${p.y}-${p2(p.m)}-${p2(p.d)} ${p2(p.hh)}:${p2(p.mm)}<small>周${WD[p.w]}</small></span>${sub}`;
}
function onsitePill(v) {
  if (!v || v === "待确认") return `<span class="pill unk">待确认</span>`;
  if (v.includes("远程")) return `<span class="pill remote">${esc(v)}</span>`;
  return `<span class="pill must">${esc(v)}</span>`;
}
function nbParts(d) {
  const [kind, text] = d.nb.includes("｜") ? d.nb.split("｜") : ["", d.nb];
  return {kind, text: text || ""};
}
function nbCell(d) {
  if (d.nbs !== "有专属条款") return `<span class="muted">${esc(d.nb || "—")}</span>`;
  const {kind, text} = nbParts(d);
  const pill = kind === "硬性" ? `<span class="pill hard">硬性</span>` : kind === "利好" ? `<span class="pill perk">利好</span>` : "";
  return `<span class="nbt" title="${esc(text)}">${pill}${esc(text)}</span>`;
}
function vsPill(d) {
  const c = d.vs === "已核实" ? "ok" : d.vs === "2027CFP未发布" ? "np" : "un";
  const label = d.vs === "2027CFP未发布" ? "CFP 未发布" : d.vs;
  return `<span class="pill ${c}" title="${esc(d.gap ? "待补：" + d.gap + "（" + d.gk + "）" : "")}">${esc(label)}</span>`;
}
function accCell(d) {
  if (d.accR === null) return `<span class="off">—</span>`;
  const a = d.acc[d.acc.length - 1];
  return `<span class="acc">${pct(a.r)}<small>${esc(a.y)} 年</small></span>`;
}

// ---------- table ----------
const COLS = [
  {k: "abbr", l: "会议", c: "c-name"},
  {k: "ccf", l: "CCF", c: "c-ccf"},
  {k: "dir", l: "方向", c: "c-dir"},
  {k: null, l: "正文截稿 · 北京时间", c: "c-dl"},
  {k: "days", l: "剩余", c: "c-days"},
  {k: "dec", l: "录用通知", c: "c-dec"},
  {k: null, l: "会期 · 地点", c: "c-when"},
  {k: null, l: "到场要求", c: "c-onsite"},
  {k: "aln", l: "投稿上限", c: "c-aln"},
  {k: "acc", l: "往届录用率", c: "c-acc"},
  {k: null, l: "新人作者条款", c: "c-nb"},
  {k: "vs", l: "核查", c: "c-vs"},
];
function head() {
  $("#th").innerHTML = COLS.map(col => {
    if (!col.k) return `<th scope="col" class="${col.c}"><span>${col.l}</span></th>`;
    const on = sort.k === col.k;
    const aria = on ? (sort.dir > 0 ? "ascending" : "descending") : "none";
    return `<th scope="col" class="${col.c}" aria-sort="${aria}"><button type="button" data-k="${col.k}">${col.l}<span class="ar" aria-hidden="true">${on && sort.dir < 0 ? "▼" : "▲"}</span></button></th>`;
  }).join("");
  const ms = $("#msort"); ms.value = `${sort.k}:${sort.dir}`; if (!ms.value) ms.selectedIndex = -1;
}
function row(d) {
  const cls = [d.status === "closed" ? "closed" : "", d.uid === openUid ? "sel" : ""].join(" ").trim();
  return `<tr data-uid="${esc(d.uid)}"${cls ? ` class="${cls}"` : ""}>
<td class="c-name"><button type="button" class="nm" aria-haspopup="dialog"><b>${hl(d.abbr)}</b><span title="${esc(d.full)}">${hl(d.full)}</span></button></td>
<td class="c-ccf"><span class="tag ${esc(d.ccf)}" title="${d.ccf === "N" ? "非 CCF 推荐" : "CCF " + esc(d.ccf) + " 类"}">${esc(d.ccf)}</span></td>
<td class="c-dir">${esc(d.dir)}</td>
<td class="c-dl">${dlCell(d)}</td>
<td class="c-days">${daysCell(d)}</td>
<td class="c-dec">${d.dec ? `<span class="date">${esc(d.dec.slice(0, 10))}</span>` : `<span class="off">—</span>`}</td>
<td class="c-when">${esc(d.date)}<span class="sub" title="${esc(d.place)}">${esc(d.place)}</span></td>
<td class="c-onsite">${onsitePill(d.onsite)}</td>
<td class="c-aln">${d.ald && d.ald !== "不限" ? esc(d.ald) : `<span class="off">${esc(d.ald || "—")}</span>`}</td>
<td class="c-acc">${accCell(d)}</td>
<td class="c-nb">${nbCell(d)}</td>
<td class="c-vs">${vsPill(d)}</td>
</tr>`;
}

const rowEl = uid => $$("#tb tr").find(tr => tr.dataset.uid === uid);
let lastSig = "";
function render(force) {
  const ts = terms();
  const scoped = DATA.filter(d => inScope(d, ts));
  const rows = scoped.filter(d => matchStatus(d) && matchWeek(d)).sort(compare);

  const cnt = {all: scoped.length, open: 0, soon: 0, tbd: 0, closed: 0};
  for (const d of scoped) { cnt[d.status]++; if (d.status === "open" && d.days <= 30) cnt.soon++; }
  for (const k of ST) $("#t-" + k).textContent = cnt[k];
  const in7 = scoped.filter(d => d.status === "open" && d.left < 7 * DAY).length;
  $("#t-soon-n").textContent = in7 ? `7 天内 ${in7} 个` : "抓紧准备";
  $$(".tile").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.st === sel.st)));

  $$("#ccfs button").forEach(b => b.setAttribute("aria-pressed", String(sel.ccf.has(b.dataset.ccf))));
  $$("#dirs .chip").forEach(b => {
    b.setAttribute("aria-pressed", String(sel.dir.has(b.dataset.dir)));
    b.querySelector(".n").textContent = DATA.filter(d => d.dir === b.dataset.dir && (!sel.ccf.size || sel.ccf.has(d.ccf))).length;
  });
  $$("[data-flag]").forEach(b => b.setAttribute("aria-pressed", String(sel[b.dataset.flag])));
  if ($("#q").value.trim() !== sel.q && document.activeElement !== $("#q")) $("#q").value = sel.q;

  renderChart(scoped);
  renderActive(rows.length);

  // only rebuild rows when something visible changed, so the minute tick never steals focus or hover
  const sig = rows.map(d => d.uid + (d.status === "open" ? JSON.stringify(leftText(d.left)) + !!d.absT : d.status)).join() + "|" + sel.q + "|" + sort.k + sort.dir;
  if (force || sig !== lastSig) {
    const focusUid = document.activeElement?.closest?.("#tb tr")?.dataset.uid;
    $("#tb").innerHTML = rows.map(row).join("");
    if (focusUid) rowEl(focusUid)?.querySelector(".nm").focus({preventScroll: true});
    lastSig = sig;
  }
  $("#empty").hidden = rows.length > 0;
  $("#tbl").hidden = rows.length === 0;
  const icsN = rows.filter(d => d.status === "open").length;
  $("#ics").disabled = icsN === 0;
  $("#ics span").textContent = icsN ? `导出日历（${icsN}）` : "导出日历";
  syncUrl();
}

function renderActive(n) {
  const parts = [];
  const add = (label, fn) => parts.push({label, fn});
  if (sel.st !== "all") add(ST_LABEL[sel.st], () => { sel.st = "all"; });
  if (sel.wk) { const w = wkStart(); add(`${md(w)}–${md(w + 6 * DAY)} 截稿`, () => { sel.wk = null; }); }
  CCF.filter(x => sel.ccf.has(x)).forEach(x => add(x === "N" ? "非 CCF" : `CCF-${x}`, () => sel.ccf.delete(x)));
  [...sel.dir].forEach(x => add(x, () => sel.dir.delete(x)));
  if (sel.nb) add("有新人条款", () => { sel.nb = false; });
  if (sel.gap) add("信息待补", () => { sel.gap = false; });
  if (sel.q) add(`搜索“${sel.q}”`, () => { sel.q = ""; $("#q").value = ""; });
  $("#count").innerHTML = parts.length ? `<b>${n}</b> / ${DATA.length} 个会议` : `全部 <b>${n}</b> 个会议`;
  const box = $("#active"); box.textContent = "";
  parts.forEach((p, i) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = p.label;
    b.setAttribute("aria-label", `移除筛选：${p.label}`);
    b.onclick = () => { p.fn(); render(); (box.children[Math.min(i, box.children.length - 1)] || $("#q")).focus({preventScroll: true}); };
    box.appendChild(b);
  });
  $("#clr").hidden = parts.length === 0;
}

// ---------- weekly deadline chart (one series, so no legend; the table is its data view) ----------
function weekBase() {
  const p = bjParts(NOW);
  return Date.parse(`${p.y}-${p2(p.m)}-${p2(p.d)}T00:00:00+08:00`) - ((p.w + 6) % 7) * DAY; // Monday 00:00 Beijing
}
function renderChart(scoped) {
  const base = weekBase();
  const weeks = Array.from({length: WEEKS}, (_, i) => ({t: base + i * 7 * DAY, list: []}));
  for (const d of scoped) {
    if (d.status !== "open") continue;
    const i = Math.floor((d.t - base) / (7 * DAY));
    if (i >= 0 && i < WEEKS) weeks[i].list.push(d);
  }
  weeks.forEach(w => w.list.sort((a, b) => a.t - b.t));
  hideTip();
  const max = Math.max(1, ...weeks.map(w => w.list.length));
  const step = max <= 4 ? 1 : max <= 8 ? 2 : max <= 20 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const plot = $("#plot"); plot.textContent = "";
  const y = document.createElement("div"); y.className = "yaxis"; y.style.marginBottom = AXIS + "px";
  const cols = document.createElement("div"); cols.className = "cols";
  for (let v = 0; v <= top; v += step) {
    const s = document.createElement("span"); s.textContent = v; s.style.bottom = `calc((100% - ${CAP}px) * ${v / top})`; y.appendChild(s);
    const g = document.createElement("div"); g.className = "grid" + (v === 0 ? " base" : "");
    g.style.bottom = `calc(${AXIS}px + (100% - ${AXIS + CAP}px) * ${v / top})`; cols.appendChild(g);
  }
  const maxI = weeks.findIndex(w => w.list.length === max);
  weeks.forEach((w, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "col";
    const key = ymd(w.t), n = w.list.length, on = sel.wk === key;
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", `${md(w.t)} 至 ${md(w.t + 6 * DAY)}：${n} 个会议截稿`);
    if (i === maxI && n) b.classList.add("show-cap");
    const cap = document.createElement("span"); cap.className = "cap"; cap.textContent = n;
    const bar = document.createElement("span"); bar.className = "bar" + (n ? "" : " zero");
    if (n) bar.style.height = `calc((100% - ${CAP}px) * ${n / top})`;
    const wk = document.createElement("span"); wk.className = "wk";
    const m = bjParts(w.t).m, prev = i ? bjParts(w.t - 7 * DAY).m : m;
    if (i === 0) { wk.textContent = "本周"; wk.classList.add("first"); if (bjParts(w.t + 7 * DAY).m !== m) wk.classList.add("crowd"); }
    else if (m !== prev) { wk.textContent = `${m}月`; wk.classList.add("month"); }
    else wk.textContent = md(w.t);
    b.append(cap, bar, wk);
    b.onmouseenter = b.onfocus = () => showTip(b, w);
    b.onmouseleave = b.onblur = hideTip;
    b.onclick = () => {
      sel.wk = on ? null : key;
      if (sel.wk && (sel.st === "tbd" || sel.st === "closed")) sel.st = "all";
      render();
      const again = $$("#plot .col")[i]; again.focus({preventScroll: true}); showTip(again, w);
    };
    cols.appendChild(b);
  });
  plot.append(y, cols);
}
function showTip(el, w) {
  const tip = $("#tip"); tip.textContent = "";
  const strong = document.createElement("strong"); strong.textContent = `${w.list.length} 个会议截稿`;
  const rng = document.createElement("div"); rng.className = "rng"; rng.textContent = `${md(w.t)}（周一）– ${md(w.t + 6 * DAY)}（周日）`;
  tip.append(strong, rng);
  if (w.list.length) {
    const names = document.createElement("div"); names.className = "names";
    names.textContent = w.list.slice(0, 10).map(d => d.abbr).join(" · ") + (w.list.length > 10 ? ` 等 ${w.list.length} 个` : "");
    tip.appendChild(names);
  }
  tip.hidden = false;
  const box = el.closest(".chart").getBoundingClientRect(), r = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.width - tip.offsetWidth - 8, r.left - box.left + r.width / 2 - tip.offsetWidth / 2));
  tip.style.left = left + "px";
  tip.style.top = Math.max(4, r.top - box.top - tip.offsetHeight + 4) + "px";
}
const hideTip = () => { $("#tip").hidden = true; };

// ---------- detail drawer ----------
const dlg = $("#drawer");
function rel(t) {
  const diff = t - NOW, a = Math.abs(diff);
  const s = a < HOUR ? `${Math.max(1, Math.round(a / 6e4))} 分钟` : a < DAY ? `${Math.round(a / HOUR)} 小时` : `${Math.round(a / DAY)} 天`;
  return diff > 0 ? `还有 ${s}` : `${s}前`;
}
function liveText(t) {
  const ms = Math.max(0, t - Date.now());
  const dd = Math.floor(ms / DAY), hh = Math.floor((ms % DAY) / HOUR), mm = Math.floor((ms % HOUR) / 6e4), ss = Math.floor((ms % 6e4) / 1e3);
  return `${dd}<small>天</small>${p2(hh)}<small>时</small>${p2(mm)}<small>分</small>${p2(ss)}<small>秒</small>`;
}
function countBox(d) {
  if (d.status === "tbd") return `<div class="count-box"><div class="lbl">2027 截稿日</div><div class="big">待公布</div><div class="when">${esc(d.gk || "等官方发布")}。数据更新后这里会显示倒计时。</div></div>`;
  if (d.status === "closed") {
    const decT = bjTime(d.dec.length === 10 ? d.dec + " 23:59" : d.dec);
    const dec = decT > NOW ? `录用通知 ${esc(d.dec.slice(0, 10))}，${rel(decT)}。` : "可关注次轮或下一届。";
    return `<div class="count-box"><div class="lbl">本届投稿</div><div class="big" style="color:var(--muted)">已截止</div><div class="when">最后一轮截稿 ${stamp(d.t)}（北京时间）。${dec}</div></div>`;
  }
  const c = d.days <= 30 ? "urgent" : d.days <= 90 ? "warn" : "ok";
  const p = bjParts(d.t);
  const abs = d.absT ? `<div class="absline${d.absT - NOW < 7 * DAY ? " hot" : ""}">摘要注册更早：${stamp(d.absT)}，<span data-live-abs>${rel(d.absT)}</span>。没注册摘要就交不了正文。</div>` : "";
  return `<div class="count-box ${c}"><div class="lbl">距离正文截稿${d.rounds.length > 1 ? `（${esc(roundName(d))}）` : ""}</div>
<div class="big" data-live>${liveText(d.t)}</div>
<div class="when">北京时间 ${p.y}-${p2(p.m)}-${p2(p.d)} 周${WD[p.w]} ${p2(p.hh)}:${p2(p.mm)}${d.tz ? ` · 官方时区 ${esc(d.tz)}` : ""}</div>${abs}</div>`;
}
function roundsBlock(d) {
  const rs = d.rounds.filter(r => r.dl || r.abs);
  if (!rs.length) return "";
  const one = r => {
    const cur = d.status === "open" && r.dl === d.cur.dl;
    let marked = false;
    // single-round: the officially verified decision date wins, same as the table column
    const dec = d.rounds.length <= 1 && d.decv ? d.decv : r.dec;
    const lines = [["摘要注册", r.abs], ["正文截稿", r.dl], ["Rebuttal", r.reb], ["录用通知", dec]].filter(x => x[1]).map(([k, v]) => {
      const t = bjTime(v.length === 10 ? v + " 23:59" : v), past = t < NOW, next = cur && !past && !marked;
      if (next) marked = true;
      return `<span>${k}</span><span class="t${past ? " past" : ""}">${esc(v)}</span><span class="rel${next ? " next" : ""}">${past ? "已过" : rel(t)}</span>`;
    }).join("");
    return `<div class="round${cur ? " cur" : ""}"><div class="rl"><span>${esc(r.l || "单轮")}</span>${cur ? "<em>当前轮次</em>" : ""}</div><div class="ms">${lines}</div></div>`;
  };
  // fold rounds whose every milestone is over; keep the latest one visible when nothing is upcoming
  const over = r => [r.abs, r.dl, r.reb, r.dec].filter(Boolean).every(v => bjTime(v.length === 10 ? v + " 23:59" : v) < NOW);
  let past = rs.filter(over);
  const live = rs.filter(r => !over(r));
  if (!live.length) { live.push(past.pop()); }
  const folded = past.length >= 2
    ? `<details class="past-rounds"><summary>已结束的 ${past.length} 轮</summary><div class="rounds">${past.map(one).join("")}</div></details>`
    : past.map(one).join("");
  return `<h3>时间线 · 北京时间</h3><div class="rounds">${folded}${live.map(one).join("")}</div>`;
}
function fact(k, v, note) {
  const val = !v || v === "待确认" ? `<span class="muted">待确认</span>` : esc(v);
  return `<dt>${k}</dt><dd>${val}${note && v && v !== "待确认" ? ` <span class="muted">${esc(note)}</span>` : ""}</dd>`;
}
function accBlock(d) {
  if (!d.acc.length) return "";
  const max = Math.max(...d.acc.map(a => a.r), 0.3);
  const rows = d.acc.map(a => `<div class="accrow"><b>${esc(a.y)}</b><div class="track"><div class="fill" style="width:${(a.r / max) * 100}%"></div></div><small>${pct(a.r)}${a.s ? ` · ${esc(a.a)}/${esc(a.s)}` : ""}</small></div>`).join("");
  return `<h3>往届录用率 · ccfddl</h3><div class="accbars">${rows}</div>`;
}
function drawerHTML(d) {
  const link = safeUrl(d.link);
  const extra = d.newbie && d.newbie !== "无特殊限制" ? `<p>${esc(d.newbie)}</p>` : "";
  let nb;
  if (d.nbs === "有专属条款") { const {kind, text} = nbParts(d); nb = `<div class="callout nb"><p><b>${esc(kind || "条款")}</b>　${esc(text)}</p>${extra}</div>`; }
  else nb = `<div class="callout"><p>${esc(d.nb || "—")}${d.nbs === "无专属条款" ? "：查过官网，没有针对新人的额外要求。" : d.nbs === "未找到" ? "：官网未写明，投稿前请再核对。" : ""}</p>${extra}</div>`;
  return `<header class="dw-head"><div>
  <div class="tags"><span class="tag ${esc(d.ccf)}">${d.ccf === "N" ? "非 CCF" : "CCF-" + esc(d.ccf)}</span><span>${esc(d.dir)}</span>${vsPill(d)}</div>
  <h2 id="dw-title" tabindex="-1">${esc(d.abbr)} 2027</h2><p class="full">${esc(d.full)}</p></div>
  <button type="button" class="dw-close" id="dw-close" aria-label="关闭详情"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
</header>
<div class="dw-body">
  ${d.topic ? `<p class="topic">${esc(d.topic)}</p>` : ""}
  ${countBox(d)}
  ${roundsBlock(d)}
  <h3>参会与投稿规则</h3>
  <dl class="facts">
    ${fact("会期", d.date)}${fact("地点", d.place)}${fact("举办形式", d.fmt)}${fact("到场要求", d.onsite)}${fact("远程参会", d.remote)}
    ${fact("投稿上限", d.ald, d.ald !== "不限" ? "按每位作者计" : "")}${fact("页数", d.pages)}${fact("评审方式", d.blind)}${fact("投稿系统", d.sys)}
  </dl>
  <h3>新人作者条款</h3>${nb}
  ${accBlock(d)}
  ${d.note ? `<h3>备注</h3><div class="callout"><p>${esc(d.note)}</p></div>` : ""}
  ${d.gap ? `<h3>信息缺口</h3><div class="callout"><p>待补：${esc(d.gap)}（${esc(d.gk)}）</p></div>` : ""}
</div>
<footer class="dw-foot">
  ${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3M11 4h5v5M16 4l-7 7"/></svg>官网</a>` : ""}
  ${d.status === "open" ? `<button type="button" class="btn" id="dw-ics"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/></svg>加入日历</button>` : ""}
  <span class="grow"></span>
  <a class="btn" href="${APP_HOME}#${encodeURIComponent(d.uid)}">知识库与出处 →</a>
</footer>`;
}
let lastFocus = null, tick = null;
function openDrawer(uid, push = true) {
  const d = DATA.find(x => x.uid === uid); if (!d) return;
  if (!dlg.open) lastFocus = document.activeElement;
  openUid = uid;
  $("#dw").innerHTML = drawerHTML(d);
  $("#dw-close").onclick = () => dlg.close();
  const icsBtn = $("#dw-ics"); if (icsBtn) icsBtn.onclick = () => download(`${d.uid}.ics`, ics([d]));
  if (!dlg.open) dlg.showModal();
  $("#dw-title").focus({preventScroll: true}); // announce the title; avoids a focus ring on the close button
  $(".dw-body").scrollTop = 0;
  if (push && !drawerPushed) { history.pushState({drawer: 1}, "", hashFor(uid)); drawerPushed = true; }
  else syncUrl();
  clearInterval(tick);
  tick = setInterval(() => {
    const live = dlg.querySelector("[data-live]"); if (live && d.t) live.innerHTML = liveText(d.t);
    const la = dlg.querySelector("[data-live-abs]"); if (la && d.absT) la.textContent = rel(d.absT);
  }, 1000);
  $$("#tb tr.sel").forEach(tr => tr.classList.remove("sel"));
  rowEl(uid)?.classList.add("sel");
}
dlg.addEventListener("close", () => {
  clearInterval(tick);
  const was = openUid; openUid = null;
  $$("#tb tr.sel").forEach(tr => tr.classList.remove("sel"));
  if (drawerPushed) { drawerPushed = false; history.back(); } else syncUrl();
  const back = lastFocus && document.contains(lastFocus) ? lastFocus : rowEl(was)?.querySelector(".nm");
  back?.focus({preventScroll: true});
});
dlg.addEventListener("click", e => {
  if (e.target !== dlg) return;
  const r = dlg.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
});
window.addEventListener("popstate", () => {
  const c = readHash();
  if (c) { drawerPushed = !!history.state?.drawer; openDrawer(c, false); }
  else if (dlg.open) { drawerPushed = false; dlg.close(); }
  head(); render(true);
});

// ---------- calendar export (.ics, RFC 5545) ----------
const icsEscape = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
function fold(line) {
  const enc = new TextEncoder(); const out = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const icsTime = t => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function ics(list, now = Date.now()) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CCF 会议助手//2027 投稿倒计时//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:CCF 2027 投稿截稿"];
  for (const d of list) {
    const link = safeUrl(d.link);
    d.rounds.forEach((r, i) => {
      for (const [kind, v, id] of [["摘要注册", r.abs, "abs"], ["正文截稿", r.dl, "dl"]]) {
        const t = bjTime(v); if (!t || t <= now) continue;
        const round = d.rounds.length > 1 ? `（${r.l || "第 " + (i + 1) + " 轮"}）` : "";
        L.push("BEGIN:VEVENT", fold(`UID:${icsEscape(d.uid)}-${i}-${id}@ccf2027`), `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(t)}`,
          fold(`SUMMARY:${icsEscape(`${d.abbr} ${kind}${round} · ${d.ccf === "N" ? "非 CCF" : "CCF-" + d.ccf}`)}`),
          fold(`DESCRIPTION:${icsEscape(`北京时间 ${v}${d.tz ? `（官方时区 ${d.tz}）` : ""}\n${d.full}${link ? "\n官网 " + link : ""}\n来自 CCF 会议助手，截稿时间请以官网为准。`)}`));
        if (link) L.push(fold(`URL:${link}`));
        for (const [trig, txt] of [["-P3D", "还有 3 天"], ["-P1D", "还有 1 天"]])
          L.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trig}`, fold(`DESCRIPTION:${icsEscape(`${d.abbr} ${kind}${txt}`)}`), "END:VALARM");
        L.push("END:VEVENT");
      }
    });
  }
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], {type: "text/calendar;charset=utf-8"}));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- wiring ----------
function init() {
  CCF.forEach(v => {
    const b = document.createElement("button"); b.type = "button"; b.dataset.ccf = v;
    b.innerHTML = `<i style="background:var(--ccf-${v.toLowerCase()})"></i>${v}`;
    b.title = v === "N" ? "非 CCF 推荐（CORE 等其他评级）" : `CCF ${v} 类`;
    b.onclick = () => { sel.ccf.has(v) ? sel.ccf.delete(v) : sel.ccf.add(v); render(); };
    $("#ccfs").appendChild(b);
  });
  DIRS.forEach(v => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.dataset.dir = v;
    const t = document.createElement("span"); t.textContent = v;
    const n = document.createElement("span"); n.className = "n";
    b.append(t, n);
    b.onclick = () => { sel.dir.has(v) ? sel.dir.delete(v) : sel.dir.add(v); render(); };
    $("#dirs").appendChild(b);
  });
  $$("[data-flag]").forEach(b => { b.onclick = () => { sel[b.dataset.flag] = !sel[b.dataset.flag]; render(); }; });
  $$(".tile").forEach(b => {
    b.onclick = () => {
      sel.st = sel.st === b.dataset.st ? "all" : b.dataset.st;
      if (sel.st === "tbd" || sel.st === "closed") sel.wk = null;
      render();
    };
  });
  let qTimer;
  $("#q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => { sel.q = e.target.value.trim().slice(0, 80); render(); }, 80); });
  $("#q").addEventListener("keydown", e => {
    if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; sel.q = ""; render(); }
    if (e.key === "Enter") { e.preventDefault(); $("#tb .nm")?.focus(); }
  });
  const reset = () => { sel = fresh(); $("#q").value = ""; render(); $("#q").focus(); };
  $("#clr").onclick = reset; $("#empty-reset").onclick = reset;
  $("#th").addEventListener("click", e => {
    const b = e.target.closest("button[data-k]"); if (!b) return;
    const k = b.dataset.k;
    sort = sort.k === k ? {k, dir: -sort.dir} : {k, dir: 1};
    head(); render(true);
    $(`#th button[data-k="${k}"]`)?.focus();
  });
  $("#msort").onchange = e => { const [k, d] = e.target.value.split(":"); sort = {k, dir: +d}; head(); render(true); };
  $("#tb").addEventListener("click", e => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-uid]"); if (tr) openDrawer(tr.dataset.uid);
  });
  $("#ics").onclick = () => {
    const list = visible().filter(d => d.status === "open");
    if (list.length) download(`ccf2027-deadlines-${ymd(Date.now())}.ics`, ics(list));
  };
  document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || dlg.open || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault(); $("#q").focus(); $("#q").select();
  });
  const totop = $("#totop");
  totop.onclick = () => { window.scrollTo({top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); $("#q").focus({preventScroll: true}); };
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { totop.hidden = window.scrollY < 900; ticking = false; });
  }, {passive: true});
  window.addEventListener("resize", hideTip);
  $("#n-total").textContent = DATA.length;
  $("#m-aoe").textContent = META.aoe; $("#m-shift").textContent = META.shifted; $("#m-gen").textContent = META.generated;
}
function clock() {
  const p = bjParts(Date.now());
  $("#now").textContent = `${p.y}-${p2(p.m)}-${p2(p.d)} 周${WD[p.w]} ${p2(p.hh)}:${p2(p.mm)}`;
  $("#now").setAttribute("datetime", new Date().toISOString());
}
function refresh() { clock(); recompute(); render(); }

const initial = readHash();
init(); recompute(); head(); render(true); clock();
if (initial) openDrawer(initial, false);
setInterval(refresh, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
window.CCF_DASHBOARD = {ics, visible, state: () => ({sel, sort, openUid})}; // for tests
})();

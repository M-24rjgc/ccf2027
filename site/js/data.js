// 知识库数据层：加载 wiki.json，提供确定性的查询函数（日期计算全部在这里，不交给 LLM）

export const DB = { pages: {}, confs: [], nodes: [], edges: [], byUid: {}, byAbbr: {}, generated: "" };

export async function loadWiki() {
  const res = await fetch("data/wiki.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`加载知识库失败：HTTP ${res.status}`);
  const b = await res.json();
  Object.assign(DB, b);
  DB.byUid = Object.fromEntries(b.confs.map(c => [c.uid, c]));
  DB.byAbbr = Object.fromEntries(b.confs.map(c => [c.abbr.toLowerCase(), c]));
  DB.nodeById = Object.fromEntries(b.nodes.map(n => [n.id, n]));
  return DB;
}

// ---------------------------------------------------------------- 时间
export const bjTime = s => (s ? Date.parse(s.replace(" ", "T") + ":00+08:00") : NaN);

export function nowBJText(now = Date.now()) {
  return new Date(now + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
}

/** 按当前时刻为会议选轮次：最早的未过期轮次；全过期取最后一轮；无日期为 TBD */
export function liveState(c, now = Date.now()) {
  const rs = (c.rounds || []).filter(x => x.dl).map(x => ({ ...x, t: bjTime(x.dl) }));
  const up = rs.filter(x => x.t > now).sort((a, b) => a.t - b.t);
  let m = null, status = "TBD";
  if (up.length) { m = up[0]; status = "未截止"; }
  else if (rs.length) { m = rs.reduce((a, b) => (a.t > b.t ? a : b)); status = "已截止"; }
  return {
    status,
    dl: m ? m.dl : "",
    abs: m ? m.abs : "",
    round: m ? m.l : "",
    dec: ((c.rounds || []).length <= 1 && c.decv) || (m && m.dec) || "",
    days_left: status === "未截止" ? Math.floor((m.t - now) / 864e5) : null,
    later_rounds: up.slice(1).map(x => `${x.l}: ${x.dl}`),
  };
}

// ---------------------------------------------------------------- 解析
export function resolveId(q) {
  if (!q) return null;
  const s = String(q).trim().replace(/^\[\[|\]\]$/g, "").split("|")[0];
  if (DB.pages[s]) return s;
  const low = s.toLowerCase();
  if (DB.byAbbr[low]) return DB.byAbbr[low].uid;
  const noYear = low.replace(/\s*(20)?2[67]$/, "").trim();
  if (DB.byAbbr[noYear]) return DB.byAbbr[noYear].uid;
  const hit = Object.entries(DB.pages).find(([, p]) => p.title.toLowerCase() === low);
  return hit ? hit[0] : null;
}

function matchDir(c, dirs) {
  if (!dirs || !dirs.length) return true;
  return dirs.some(d => {
    const x = String(d).toLowerCase();
    return c.dir.toLowerCase().includes(x) || x.includes(c.dir.toLowerCase()) ||
      c.dir_id === x || c.dir_id === "dir-" + x;
  });
}

// ---------------------------------------------------------------- 工具实现
const CCF_ORDER = { A: 0, B: 1, C: 2, N: 3 };

export function filterConferences(p = {}, now = Date.now()) {
  const ccf = (p.ccf || []).map(x => String(x).toUpperCase().replace("CCF-", ""));
  const kw = (p.keywords || []).map(k => String(k).toLowerCase()).filter(Boolean);
  const from = p.deadline_from ? bjTime(p.deadline_from + " 00:00") : -Infinity;
  const to = p.deadline_to ? bjTime(p.deadline_to + " 23:59") : Infinity;
  const status = p.status || "open";
  let out = [];
  for (const c of DB.confs) {
    const s = liveState(c, now);
    if (ccf.length && !ccf.includes(c.ccf)) continue;
    if (!matchDir(c, p.directions)) continue;
    if (status === "open" && s.status !== "未截止") continue;
    if (status === "closed" && s.status !== "已截止") continue;
    if (status === "tbd" && s.status !== "TBD") continue;
    if (p.within_days != null && !(s.days_left != null && s.days_left <= p.within_days)) continue;
    if (p.min_days != null && !(s.days_left != null && s.days_left >= p.min_days)) continue;
    const t = bjTime(s.dl);
    if ((p.deadline_from || p.deadline_to) && !(t >= from && t <= to)) continue;
    if (p.exclude_onsite_required && c.onsite === "必须到场") continue;
    if (p.exclude_newbie_hard && c.nb_impact === "有硬性要求") continue;
    if (p.verified_only && c.vstatus !== "已核实") continue;
    if (p.concept && !c.concepts.includes(p.concept)) continue;
    if (kw.length) {
      const hay = `${c.abbr} ${c.full} ${c.topic} ${c.dir}`.toLowerCase();
      if (!kw.some(k => hay.includes(k))) continue;
    }
    out.push({ c, s });
  }
  const sort = p.sort || "deadline";
  out.sort((a, b) => {
    if (sort === "ccf") return CCF_ORDER[a.c.ccf] - CCF_ORDER[b.c.ccf] || (a.s.days_left ?? 1e9) - (b.s.days_left ?? 1e9);
    if (sort === "accept_rate") return (a.c.acc.at(-1)?.r ?? 9) - (b.c.acc.at(-1)?.r ?? 9);
    return (bjTime(a.s.dl) || 9e15) - (bjTime(b.s.dl) || 9e15);
  });
  const total = out.length;
  out = out.slice(0, Math.min(p.limit || 30, 60));
  return {
    now_beijing: nowBJText(now), total, returned: out.length,
    results: out.map(({ c, s }) => ({
      uid: c.uid, abbr: c.abbr, ccf: c.ccf, direction: c.dir, topic: c.topic,
      status: s.status, deadline_bj: s.dl || "待公布", round: s.round, days_left: s.days_left,
      later_rounds: s.later_rounds.length ? s.later_rounds : undefined,
      date: c.date, place: c.place, onsite: c.onsite, remote: c.remote, author_limit: c.al,
      newbie: c.nb_status === "有专属条款" ? `${c.nb_impact}${c.nb_hard ? "：" + c.nb_hard : ""}` : c.nb_status,
      vstatus: c.vstatus, gap: c.gap || undefined,
      accept_rate: c.acc.length ? c.acc.map(a => `${a.y}:${a.r != null ? (a.r * 100).toFixed(1) + "%" : "—"}`).join(" ") : undefined,
    })),
  };
}

// 中文按二元组、英文按词切分的简易检索
function terms(q) {
  const out = [];
  for (const seg of String(q).toLowerCase().split(/[\s,，。；;、/|()（）?？!！:："'“”]+/)) {
    if (!seg) continue;
    if (/[一-鿿]/.test(seg)) {
      if (seg.length <= 2) out.push(seg);
      else for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
    } else if (seg.length >= 2) out.push(seg);
  }
  return [...new Set(out)];
}

export function searchWiki(query, limit = 8) {
  const ts = terms(query);
  if (!ts.length) return { results: [] };
  const scored = [];
  for (const [id, p] of Object.entries(DB.pages)) {
    if (p.type === "meta") continue;
    const title = p.title.toLowerCase(), md = p.md.toLowerCase();
    let sc = 0;
    for (const t of ts) {
      if (title.includes(t)) sc += 6;
      let n = 0, i = -1;
      while (n < 5 && (i = md.indexOf(t, i + 1)) >= 0) n++;
      sc += n;
    }
    const c = DB.byUid[id];
    if (c && ts.includes(c.abbr.toLowerCase())) sc += 25;
    if (sc > 0) scored.push({ id, sc, p });
  }
  scored.sort((a, b) => b.sc - a.sc);
  return {
    results: scored.slice(0, limit).map(({ id, p }) => {
      const md = p.md.replace(/^---[\s\S]*?---\n/, "");
      const pos = Math.max(0, md.toLowerCase().indexOf(ts[0]) - 40);
      return { id, type: p.type, title: p.title, snippet: md.slice(pos, pos + 160).replace(/\n+/g, " ") };
    }),
  };
}

export function readIndex(p = {}) {
  const lines = DB.pages.index.md.split("\n");
  if (!p.direction && !p.ccf) return { text: DB.pages.index.md };
  const ccf = (p.ccf || []).map(x => String(x).toUpperCase());
  const keep = lines.filter(l => {
    if (!l.startsWith("- [[")) return false;
    const m = l.match(/^- \[\[([^|\]]+)/);
    const c = m && DB.byUid[m[1]];
    if (!c) return false;
    if (ccf.length && !ccf.includes(c.ccf)) return false;
    if (p.direction && !matchDir(c, [p.direction])) return false;
    return true;
  });
  return { count: keep.length, text: keep.join("\n") };
}

export function readPage(id) {
  const pid = resolveId(id);
  if (!pid) return { error: `找不到页面「${id}」。可先用 search_wiki 搜索。` };
  const p = DB.pages[pid];
  const c = DB.byUid[pid];
  const out = { id: pid, type: p.type, markdown: p.md };
  if (c) {
    const s = liveState(c);
    out.live = { now_beijing: nowBJText(), status: s.status, current_round: s.round, deadline_bj: s.dl, days_left: s.days_left };
  }
  return out;
}

/** 沿关系图走 1–2 跳。dense 概念（AoE / CCF 评级 / 现场报告）连接太多，默认不展开 */
export function graphNeighbors(id, hops = 1, rel = null) {
  const start = resolveId(id);
  if (!start) return { error: `找不到节点「${id}」` };
  const adj = {};
  for (const e of DB.edges) {
    if (e.dense && !(rel && e.rel.includes(rel)) && !(DB.nodeById[start]?.type === "concept")) continue;
    if (rel && !e.rel.includes(rel)) continue;
    (adj[e.s] ||= []).push({ to: e.t, rel: e.rel });
    (adj[e.t] ||= []).push({ to: e.s, rel: e.rel });
  }
  const seen = new Set([start]);
  let frontier = [start];
  const found = [];
  for (let h = 1; h <= Math.min(hops, 2); h++) {
    const next = [];
    for (const u of frontier) for (const { to, rel: r } of adj[u] || []) {
      if (seen.has(to)) continue;
      seen.add(to); next.push(to);
      const n = DB.nodeById[to];
      const c = DB.byUid[to];
      found.push({ id: to, label: n?.label, type: n?.type, rel: r, via: u, hop: h, ccf: c?.ccf });
    }
    frontier = next;
  }
  return { center: start, total: found.length, neighbors: found.slice(0, 80) };
}

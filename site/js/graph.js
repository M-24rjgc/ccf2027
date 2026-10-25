// 关系图：会议（按 CCF 着色）· 方向 · 概念 · 同期同地。点击看邻居，双击打开页面。
import { DB } from "./data.js";

let cy = null;
let toggles = { concept: true, colo: true, dense: false };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const SIZE = { A: 26, B: 20, C: 16, N: 13 };

export function initGraph(container, { onOpen, onSelect }) {
  const els = [];
  for (const n of DB.nodes) {
    els.push({ data: { id: n.id, label: n.label, type: n.type, ccf: n.ccf || "", dense: n.dense ? 1 : 0 } });
  }
  DB.edges.forEach((e, i) => {
    const kind = e.rel === "方向" ? "dir" : e.rel === "同期同地" ? "colo" : "concept";
    els.push({ data: { id: "e" + i, source: e.s, target: e.t, rel: e.rel, kind, dense: e.dense ? 1 : 0 } });
  });

  cy = cytoscape({
    container, elements: els, wheelSensitivity: 0.25, minZoom: 0.15, maxZoom: 3,
    style: style(),
    layout: { name: "preset", positions: clusterPositions(), fit: true, padding: 20 },
  });
  applyToggles(toggles);

  cy.on("tap", "node", ev => { focus(ev.target.id()); onSelect?.(ev.target.id()); });
  cy.on("dbltap", "node", ev => onOpen?.(ev.target.id()));
  cy.on("tap", ev => { if (ev.target === cy) { clearHighlight(); onSelect?.(null); } });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => cy.style(style()));
  return cy;
}

/** 分簇布局：方向节点围成大圆，会议按 CCF 由内到外环绕各自方向；概念节点在中心小圆上 */
function clusterPositions() {
  const pos = {};
  const dirs = DB.nodes.filter(n => n.type === "direction");
  const R = 640;
  dirs.forEach((d, i) => {
    const a = (2 * Math.PI * i) / dirs.length - Math.PI / 2;
    const cx = R * Math.cos(a), cy = R * Math.sin(a);
    pos[d.id] = { x: cx, y: cy };
    const confs = DB.nodes.filter(n => n.type === "conference" && n.dir === d.id)
      .sort((x, y) => "ABCN".indexOf(x.ccf) - "ABCN".indexOf(y.ccf) || x.label.localeCompare(y.label));
    let k = 0, ring = 1;
    while (k < confs.length) {
      const cap = 8 * ring, r = 46 + 34 * ring;
      const n = Math.min(cap, confs.length - k);
      for (let j = 0; j < n; j++) {
        const t = (2 * Math.PI * j) / n + ring * 0.4;
        pos[confs[k + j].id] = { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
      }
      k += n; ring++;
    }
  });
  const cs = DB.nodes.filter(n => n.type === "concept");
  cs.forEach((c, i) => {
    const a = (2 * Math.PI * i) / cs.length;
    pos[c.id] = { x: 200 * Math.cos(a), y: 200 * Math.sin(a) };
  });
  return pos;
}

function style() {
  const ccfColor = { A: css("--ccf-a"), B: css("--ccf-b"), C: css("--ccf-c"), N: css("--ccf-n") };
  return [
    { selector: "node", style: { label: "data(label)", "font-size": 9, color: css("--ink2"), "text-valign": "bottom",
        "text-margin-y": 3, "min-zoomed-font-size": 7, "border-width": 0, "transition-property": "opacity", "transition-duration": "150ms" } },
    ...Object.entries(ccfColor).map(([k, c]) => ({ selector: `node[type="conference"][ccf="${k}"]`,
      style: { "background-color": c, width: SIZE[k], height: SIZE[k] } })),
    { selector: 'node[type="direction"]', style: { shape: "round-rectangle", "background-color": css("--navy"), width: 120, height: 34,
        label: "data(label)", color: "#fff", "text-valign": "center", "text-margin-y": 0, "font-size": 15, "font-weight": 600,
        "text-wrap": "ellipsis", "text-max-width": 114, "min-zoomed-font-size": 0 } },
    { selector: 'node[type="concept"]', style: { shape: "diamond", "background-color": css("--violet"), width: 24, height: 24,
        "font-size": 13, color: css("--violet"), "font-weight": 600, "min-zoomed-font-size": 0 } },
    { selector: "edge", style: { width: 0.8, "line-color": css("--edge"), "curve-style": "haystack", opacity: 0.55 } },
    { selector: 'edge[kind="concept"]', style: { "line-color": css("--violet"), opacity: 0.3, "line-style": "dashed" } },
    { selector: 'edge[kind="colo"]', style: { "line-color": css("--amber"), width: 2, opacity: 0.85 } },
    { selector: ".hidden", style: { display: "none" } },
    { selector: ".faded", style: { opacity: 0.08 } },
    { selector: "node.hl", style: { opacity: 1, "border-width": 3, "border-color": css("--accent"), "z-index": 10, "font-size": 11, color: css("--ink"), "font-weight": 600 } },
    { selector: "node.hl2", style: { opacity: 1, "z-index": 9 } },
    { selector: "edge.hl", style: { opacity: 0.95, width: 2, "line-color": css("--accent"), "z-index": 8 } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": css("--accent") } },
  ];
}

export function applyToggles(t) {
  toggles = { ...toggles, ...t };
  const { concept, colo, dense } = toggles;
  if (!cy) return;
  cy.batch(() => {
    cy.edges('[kind="concept"]').forEach(e => e.toggleClass("hidden", !concept || (!dense && e.data("dense") === 1)));
    cy.edges('[kind="colo"]').toggleClass("hidden", !colo);
    cy.nodes('[type="concept"]').forEach(n => n.toggleClass("hidden", !concept || (!dense && n.data("dense") === 1)));
  });
}

export function clearHighlight() {
  if (!cy) return;
  cy.elements().removeClass("faded hl hl2");
  applyToggles({});
}

/** 高亮一个节点及其可见邻居 */
export function focus(id) {
  if (!cy) return;
  const n = cy.getElementById(id);
  if (!n.nonempty()) return;
  const nb = n.closedNeighborhood().filter(":visible");
  cy.batch(() => {
    cy.elements().addClass("faded").removeClass("hl hl2");
    nb.removeClass("faded");
    nb.nodes().addClass("hl2");
    n.addClass("hl");
    n.connectedEdges().filter(":visible").addClass("hl");
  });
  cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 300 });
}

/** 高亮回答的推理路径：weight 3=回答引用，2=读过页面，1=检索/筛选命中 */
export function highlightPath(visited) {
  if (!cy || !visited?.size) return;
  const ids = [...visited.keys()].filter(id => cy.getElementById(id).nonempty());
  if (!ids.length) return;
  const set = new Set(ids);
  cy.batch(() => {
    cy.elements().addClass("faded").removeClass("hl hl2");
    for (const id of ids) {
      const n = cy.getElementById(id);
      n.removeClass("faded").addClass(visited.get(id) >= 2 ? "hl" : "hl2");
      // 显示被选中节点之间的边，以及会议到其方向节点的边
      n.connectedEdges().forEach(e => {
        const other = e.source().id() === id ? e.target() : e.source();
        if (set.has(other.id()) || other.data("type") === "direction") {
          e.removeClass("faded hidden").addClass("hl");
          other.removeClass("faded");
        }
      });
    }
  });
  cy.animate({ fit: { eles: cy.elements(".hl, .hl2"), padding: 40 } }, { duration: 400 });
}

export function findNode(q) {
  if (!cy || !q) return null;
  const low = q.toLowerCase();
  const n = cy.nodes().filter(n => (n.data("label") || "").toLowerCase().includes(low)).first();
  if (n.nonempty()) { focus(n.id()); return n.id(); }
  return null;
}

export function fitAll() { cy?.animate({ fit: { padding: 20 } }, { duration: 300 }); }
export function resize() { cy?.resize(); }

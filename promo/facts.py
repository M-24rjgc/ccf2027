# -*- coding: utf-8 -*-
"""宣传片用到的事实：知识库规模、概念页覆盖面、真实 Agent 运行记录（工具调用、访问顺序、推理子图）。
全部从 site/data/wiki.json 与 promo/assets/agent/trace.json 计算，输出 promo/out/facts.js（window.FACTS）。
先运行 node promo/capture-agent.mjs 得到 trace.json。"""
import json, os, re
from collections import Counter

D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(D)
wiki = json.load(open(os.path.join(ROOT, "site", "data", "wiki.json"), encoding="utf-8"))
trace = json.load(open(os.path.join(D, "assets", "agent", "trace.json"), encoding="utf-8"))
nodes = {n["id"]: n for n in wiki["nodes"]}
by_label = {}
for n in wiki["nodes"]:
    by_label.setdefault(n["label"], n["id"])
    if n["type"] == "conference":
        by_label.setdefault(n["label"] + " 2027", n["id"])

types = Counter(p["type"] for p in wiki["pages"].values())
members = Counter(e["t"] for e in wiki["edges"])
concepts = {n["id"]: {"label": n["label"], "members": members[n["id"]]} for n in wiki["nodes"] if n["type"] == "concept"}

# ---- the agent run, in the order it touched the knowledge base
steps = trace["steps"]
order = []
def touch(i):
    if i in nodes and i not in order:
        order.append(i)
step_nodes = []
for s in steps:
    hit = []
    if s["tool"] == "读页面":
        m = re.search(r"id=(\S+)", s["args"] or "")
        if m: hit = [m.group(1)]
    elif s["tool"] == "检索知识库":
        names = re.split(r"[、，]", (s["result"] or "").split("：", 1)[-1])
        hit = [by_label[x.strip()] for x in names if x.strip() in by_label]
    elif s["tool"] == "筛选会议":
        names = re.split(r"[、，]", (s["result"] or "").split("：", 1)[-1].rstrip("…"))
        hit = [by_label[x.strip()] for x in names if x.strip() in by_label]
    for h in hit: touch(h)
    step_nodes.append(hit)

recommended = []  # conferences linked in the final answer, in order of appearance
for m in re.finditer(r'data-id="([^"]+)"', trace["answerHtml"]):
    if m.group(1) in nodes and m.group(1) not in recommended:
        recommended.append(m.group(1))
# the answer's own sections (h2 headings) and which conferences each one names — the agent's verdict per conference
sections = []
for part in re.split(r"<h2>", trace["answerHtml"])[1:]:
    title = re.sub(r"<[^>]+>", "", part.split("</h2>", 1)[0]).strip()
    ids = []
    for m in re.finditer(r'data-id="([^"]+)"', part):
        if m.group(1) in nodes and m.group(1) not in ids and not any(m.group(1) in s["ids"] for s in sections):
            ids.append(m.group(1))
    sections.append({"title": title, "ids": ids})

# reasoning subgraph: directions the agent read + conferences it read or recommended + the concepts that explain the risks
sub = [x for x in order if nodes[x]["type"] == "direction"]
confs = [x for x in order if nodes[x]["type"] == "conference" and (x in recommended or any(x in h for h, s in zip(step_nodes, steps) if s["tool"] == "读页面"))]
confs += [x for x in recommended if x not in confs]
concept_ids = ["onsite-required", "submission-cap", "student-support"]
sub_nodes = sub + confs + concept_ids
edges = [{"s": e["s"], "t": e["t"], "rel": e["rel"]} for e in wiki["edges"] if e["s"] in sub_nodes and e["t"] in sub_nodes]

foot = trace.get("foot", "")
facts = {
    "wiki": {"pages": wiki["counts"]["pages"], "edges": wiki["counts"]["edges"], "types": dict(types)},
    "concepts": concepts,
    "agent": {
        "question": trace["question"],
        "route": trace["route"].split("\n")[0],
        "seconds": float(re.search(r"用时 ([\d.]+)", foot).group(1)),
        "visited": int(re.search(r"引用关系（(\d+)）", foot).group(1)),
        "steps": [{"tool": s["tool"], "args": s["args"], "result": (s["result"] or "").lstrip("→ ").strip(), "nodes": n} for s, n in zip(steps, step_nodes)],
        "frames": [{"file": f"run-{x['i']:03d}.jpg", "t": round(x["t"], 1), "steps": x["steps"], "chars": x["chars"]} for x in trace["log"]],
        "recommended": recommended,
        "sections": sections,
        "graph": {"nodes": [{"id": i, "label": nodes[i]["label"], "type": nodes[i]["type"], "ccf": nodes[i].get("ccf")} for i in sub_nodes], "edges": edges},
    },
}
os.makedirs(os.path.join(D, "out"), exist_ok=True)
with open(os.path.join(D, "out", "facts.js"), "w", encoding="utf-8") as f:
    f.write("window.FACTS = " + json.dumps(facts, ensure_ascii=False) + ";\n")
a = facts["agent"]
print(f"wiki {facts['wiki']}; agent {len(a['steps'])} steps, {a['seconds']}s, visited {a['visited']}; order {order}; recommended {recommended}; subgraph {len(sub_nodes)} nodes / {len(edges)} edges")

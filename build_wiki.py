# -*- coding: utf-8 -*-
"""merged.json + accept_rates.json + concepts.json -> LLM Wiki（wiki/*.md）+ 站点数据包（site/data/wiki.json）

Wiki 结构（Karpathy LLM Wiki 模式）：
  wiki/SCHEMA.md            维护规则（人工编写，不由本脚本生成）
  wiki/index.md             总目录：LLM 回答问题时先读它
  wiki/log.md               变更日志，由 changelog.jsonl 渲染
  wiki/LINT.md              体检报告：断链、孤立页、缺出处、信息缺口
  wiki/conferences/<uid>.md 每个会议一页
  wiki/directions/<id>.md   每个 CCF 方向一页
  wiki/concepts/<id>.md     跨会议的概念页
页面之间用 [[id]] 或 [[id|显示名]] 互链，链接即关系图的边。"""
import json, os, re, glob, shutil, datetime
from collections import Counter, defaultdict

D = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(D, "wiki")
SITE_DATA = os.path.join(D, "site", "data")
NOW_BJ = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=8)

rows = json.load(open(os.path.join(D, "merged.json"), encoding="utf-8"))
acc_doc = json.load(open(os.path.join(D, "accept_rates.json"), encoding="utf-8"))
ACC = acc_doc["rates"]
CONCEPTS = json.load(open(os.path.join(D, "concepts.json"), encoding="utf-8"))
ARR = json.load(open(os.path.join(D, "arr_cycles.json"), encoding="utf-8"))

NA = {"", "无", "无门槛", "无审稿义务", "未提及", "待确认", "未找到", "未知", "—", "None", "不强制"}
ARR_CONFS = {"ACL", "NAACL", "EACL", "COLING", "EMNLP", "AACL"}
DIR_ORDER = ["AI", "DS", "NW", "SC", "SE", "DB", "CT", "CG", "HI", "MX"]


def dir_id(sub):
    return "dir-" + (sub or "na").lower()


def link(pid, label=None):
    return f"[[{pid}|{label}]]" if label and label != pid else f"[[{pid}]]"


def cell(v):
    return str(v if v not in (None, "") else "—").replace("|", "／").replace("\n", " ")


# ---------------------------------------------------------------- 关系
def concept_members(r):
    out = []
    if r["tz"] in ("AoE", "UTC-12"):
        out.append("aoe")
    out.append("ccf-rating")
    if r["abbr_raw"] in ARR_CONFS:
        out.append("arr")
    rv = r.get("nb_review", "")
    if rv not in NA:
        out.append("reserve-reviewer" if re.search(r"reserve|Reserve|后备", rv) else "reciprocal-review")
    if r.get("system") == "OpenReview" or "OpenReview" in r.get("nb_account", ""):
        out.append("openreview")
    if "ORCID" in r.get("nb_account", ""):
        out.append("orcid")
    if r.get("al_n") is not None:
        out.append("submission-cap")
    if r.get("onsite") == "必须到场":
        out.append("onsite-required")
    if r.get("nb_track", "") not in NA or r.get("nb_fee", "") not in NA:
        out.append("student-support")
    if r["round_count"] > 1:
        out.append("multi-round")
    return out


for r in rows:
    r["concepts"] = concept_members(r)

# 同期同地：会期与地点完全相同（如 Evo* 系列、CPS-IoT Week）
norm = lambda s: re.sub(r"\s+", " ", (s or "").strip().lower())
colo = defaultdict(list)
for r in rows:
    if r["date_text"] and r["place"]:
        colo[(norm(r["date_text"]), norm(r["place"]))].append(r["uid"])
COLO = {}
for grp in colo.values():
    if len(grp) > 1:
        for u in grp:
            COLO[u] = [x for x in grp if x != u]

BY_UID = {r["uid"]: r for r in rows}
CONCEPT_BY_ID = {c["id"]: c for c in CONCEPTS}
SUBS = {r["sub"]: r["sub_cn"] for r in rows}


# ---------------------------------------------------------------- 会议页
def conf_page(r):
    p = r["prov"]
    tag = lambda k: f"〔{p.get(k, '知识补全')}〕"
    L = []
    L.append("---")
    for k, v in (("id", r["uid"]), ("type", "conference"), ("abbr", r["abbr"]), ("ccf", r["ccf"]),
                 ("direction", r["sub_cn"]), ("vstatus", r["vstatus"]), ("confidence", r["conf_final"]),
                 ("nb_status", r["nb_status"]), ("gap", r["gap"] or "无"), ("updated", f"{NOW_BJ:%Y-%m-%d}")):
        L.append(f"{k}: {v}")
    L.append("---")
    L.append(f"# {r['abbr']} 2027 · {r['full']}")
    L.append("")
    L.append(f"{link('ccf-rating', 'CCF-' + r['ccf'])} · {link(dir_id(r['sub']), r['sub_cn'])} · 会期 {r['date_text'] or '待公布'} · "
             f"{r['place'] or '地点待公布'} · 官网 {r['link'] or '—'}")
    L.append("")
    L.append(f"**定位**：{r['topic']} {tag('topic')}")
    L.append("")

    L.append("## 截稿时间（北京时间）")
    if r["rounds_bj"]:
        L.append("| 轮次 | 摘要截稿 | 正文截稿 | Rebuttal | 录用通知 |")
        L.append("|---|---|---|---|---|")
        for x in r["rounds_bj"]:
            dec = r.get("decision_v") if (r["round_count"] == 1 and r.get("decision_v")) else x["dec"]
            L.append(f"| {cell(x['l'])} | {cell(x['abs'])} | {cell(x['dl'])} | {cell(x['reb'])} | {cell(dec)} |")
    else:
        L.append("截稿时间待公布。")
    tzline = f"原始时区 {r['tz'] or '—'}"
    if "aoe" in r["concepts"]:
        tzline += f"，折北京时间 +20 小时（见 {link('aoe', 'AoE 时区')}）"
    if r["abbr_raw"] in ARR_CONFS:
        tzline += f"。本会走 {link('arr', 'ARR')} 滚动审稿，上表是 commit / 会议节点"
    L.append("")
    L.append(tzline + "。剩余天数按当前时间由查询工具计算，页面不写死。")
    L.append("")

    L.append("## 参会要求")
    L.append(f"- 举办形式：{r['format']} {tag('format')}")
    L.append(f"- 是否必须到场：{r['onsite']} {tag('onsite')}")
    L.append(f"- 远程参会：{r['remote']} {tag('remote')}")
    L.append("")

    L.append("## 投稿规则")
    lim = r["al_disp"] + (f"（原文：{r['author_limit']}）" if r["author_limit"] not in (r["al_disp"], "不限", "待确认") else "")
    L.append(f"- 作者投稿上限（按每位作者计，各自独立，不是合著者共享）：{lim} {tag('author_limit')}" + (f"，见 {link('submission-cap', '投稿上限')}" if r["al_n"] is not None else ""))
    L.append(f"- 页数：{r['pages']} {tag('pages')}")
    L.append(f"- 盲审：{r['blind']} {tag('blind')}")
    L.append(f"- 投稿系统：{r['system']} {tag('system')}")
    ranks = " · ".join(x for x in (f"CORE {r['core']}" if r["core"] else "", f"THCPL {r['thcpl']}" if r["thcpl"] else "") if x)
    if ranks:
        L.append(f"- 其他排名：{ranks}")
    L.append("")

    L.append(f"## 新人作者条款：{r['nb_status']}")
    src = p.get("nb", "")
    if r["nb_status"] in ("有专属条款", "无专属条款"):
        for label, k in (("A 审稿义务", "nb_review"), ("B 首投配额", "nb_quota"), ("C 资深作者", "nb_senior"),
                         ("D 账号门槛", "nb_account"), ("E 学生/新人通道", "nb_track"), ("F 费用与资助", "nb_fee")):
            L.append(f"- {label}：{r.get(k) or '—'}")
        L.append(f"- 首投实际可投篇数：{r['nb_cap']}")
        L.append(f"- 对首投的影响：{r['nb_impact']}" + (f"（{r['nb_hard']}）" if r["nb_hard"] else ""))
        if r.get("nb_note"):
            L.append(f"- 备注：{r['nb_note']}")
        L.append(f"- 出处：{r['nb_evidence'] or '—'} 〔{src}，置信度 {r.get('nb_conf') or '—'}〕")
    elif r["nb_status"] == "CFP未发布":
        L.append("2027 CFP 尚未发布，新人条款未核查；不要用上一届条款代替。")
    else:
        L.append(f"已查但未找到相关条款页（{r.get('nb_note') or '原因未记录'}）。不等于没有条款。")
    related = [c for c in ("reciprocal-review", "reserve-reviewer", "openreview", "orcid", "student-support") if c in r["concepts"]]
    if related:
        L.append("- 相关概念：" + "、".join(link(c, CONCEPT_BY_ID[c]["title"]) for c in related))
    L.append("")

    L.append("## 往届录用率")
    acc = ACC.get(r["uid"], [])
    if acc:
        L.append("| 年份 | 投稿 | 录用 | 录用率 | 出处 |")
        L.append("|---|---|---|---|---|")
        for a in acc[-6:]:
            rate = f"{a['rate'] * 100:.1f}%" if isinstance(a.get("rate"), (int, float)) else "—"
            L.append(f"| {a['year']} | {cell(a.get('submitted'))} | {cell(a.get('accepted'))} | {rate} | {a.get('source') or '—'} |")
        L.append("")
        L.append("数据来自 ccfddl/ccf-deadlines（MIT），各年口径以出处为准（有的含 desk reject，有的只算主会长文）。")
    else:
        L.append("暂无往届录用率数据。")
    L.append("")

    L.append("## 信息缺口")
    if r["gap"]:
        L.append(f"- 缺：{r['gap']}（{r['gap_kind']}）")
        L.append(f"- 下一步：{r['gap_action']}")
    else:
        L.append("无。")
    L.append("")

    L.append("## 出处与置信度")
    L.append(f"- 官网核查：{r['vstatus']}" + (f"，{r['evidence']}" if r["evidence"] else ""))
    L.append(f"- 综合置信度：{r['conf_final']}（高=官网已核实；中=合理推断；低=沿用上届或推测）")
    L.append("- 字段来源标注：〔知识补全〕= 模型已有知识，未经官网核实；〔官网核查〕〔缺口重查〕= 读到官方页面")
    if r["note_final"]:
        L.append(f"- 备注：{r['note_final']}")
    L.append("")

    L.append("## 关联")
    L.append(f"- 方向：{link(dir_id(r['sub']), r['sub_cn'])}")
    cs = [c for c in r["concepts"] if c != "ccf-rating"]
    if cs:
        L.append("- 概念：" + "、".join(link(c, CONCEPT_BY_ID[c]["title"]) for c in cs))
    if r["uid"] in COLO:
        L.append("- 同期同地：" + "、".join(link(u, BY_UID[u]["abbr"]) for u in COLO[r["uid"]]))
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- 方向页 / 概念页
def dir_page(sub):
    rs = [r for r in rows if r["sub"] == sub]
    L = ["---", f"id: {dir_id(sub)}", "type: direction", f"count: {len(rs)}", "---",
         f"# {SUBS[sub]}（{sub}）", "",
         f"CCF 目录方向，本库收录 2027 届会议 {len(rs)} 个。", ""]
    for grade in ("A", "B", "C", "N"):
        g = [r for r in rs if r["ccf"] == grade]
        if not g:
            continue
        L.append(f"## CCF-{grade}（{len(g)}）")
        for r in sorted(g, key=lambda r: r["abbr"]):
            dl = r["full_dl"][:10] if r["full_dl"] else "待公布"
            L.append(f"- {link(r['uid'], r['abbr'])}：{r['topic']}（截稿 {dl}）")
        L.append("")
    return "\n".join(L)


def arr_table():
    L = ["| Cycle | 投稿截止 | 审稿意见截止 | 作者回复 | Meta-review |", "|---|---|---|---|---|"]
    for c in ARR["cycles"]:
        L.append(f"| {c['name']} | {c['submission']} | {c['reviews_due']} | {c['author_response']} | {c['meta_release']} |")
    L.append("")
    L.append(f"数据源 {ARR['source']}（核对于 {ARR['checked']}）。{ARR.get('upcoming_note', '')}")
    return "\n".join(L)


def concept_page(c):
    mem = [r for r in rows if c["id"] in r["concepts"]]
    body = c["body"].replace("{{ARR_TABLE}}", arr_table())
    L = ["---", f"id: {c['id']}", "type: concept", f"members: {len(mem)}", "---", f"# {c['title']}", "", body, ""]
    if c["dense"]:
        L.append(f"本库共 {len(mem)} 个会议适用，太多不逐一列出；按方向浏览见各方向页。")
    elif mem:
        L.append(f"## 本库中适用的会议（{len(mem)}）")
        for r in sorted(mem, key=lambda r: ("ABCN".index(r["ccf"]), r["abbr"])):
            why = {"reciprocal-review": r["nb_review"], "reserve-reviewer": r["nb_review"],
                   "openreview": r["nb_account"] if "OpenReview" in r["nb_account"] else "投稿系统 OpenReview",
                   "orcid": r["nb_account"], "submission-cap": r["al_disp"],
                   "student-support": "；".join(x for x in (r["nb_track"], r["nb_fee"]) if x not in NA),
                   "multi-round": f"{r['round_count']} 轮", "arr": r["round_label"]}.get(c["id"], "")
            L.append(f"- {link(r['uid'], r['abbr'])}（CCF-{r['ccf']}）：{why}")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- 目录 / 日志
def index_page():
    L = ["# 索引", "",
         f"本知识库收录 CCF 推荐会议 2027 届 {len(rows)} 个（A {sum(r['ccf'] == 'A' for r in rows)} · "
         f"B {sum(r['ccf'] == 'B' for r in rows)} · C {sum(r['ccf'] == 'C' for r in rows)} · N {sum(r['ccf'] == 'N' for r in rows)}）。"
         "回答问题时先读本页，再进入具体页面。时间均为北京时间。", "",
         "## 方向", ""]
    for sub in DIR_ORDER:
        if sub in SUBS:
            L.append(f"- {link(dir_id(sub), SUBS[sub])}：{sum(r['sub'] == sub for r in rows)} 个会议")
    L += ["", "## 概念", ""]
    for c in CONCEPTS:
        L.append(f"- {link(c['id'], c['title'])}")
    L += ["", "## 会议", "", "格式：简称 · CCF · 方向 · 正文截稿（北京，最近一轮） · 核查状态 · 定位", ""]
    for sub in DIR_ORDER:
        for r in sorted((r for r in rows if r["sub"] == sub), key=lambda r: ("ABCN".index(r["ccf"]), r["abbr"])):
            dl = r["full_dl"][:10] if r["full_dl"] else "待公布"
            L.append(f"- {link(r['uid'], r['abbr'])} · {r['ccf']} · {r['sub_cn']} · {dl} · {r['vstatus']} · {r['topic']}")
    return "\n".join(L) + "\n"


CHANGELOG = os.path.join(D, "changelog.jsonl")
if not os.path.exists(CHANGELOG):
    seed = [
        {"date": "2026-10-24", "kind": "ingest", "text": "ccfddl allconf.json 抽取 2027 届会议 200 个，时间折算北京时间"},
        {"date": "2026-10-24", "kind": "ingest", "text": "波次1 知识补全：研究主题、页数、盲审、投稿系统等（未经官网核实）"},
        {"date": "2026-10-24", "kind": "verify", "text": "波次2 官网核查：读官方 CFP 核实到场、远程、投稿上限、录用通知"},
        {"date": "2026-10-24", "kind": "verify", "text": "波次3 新人作者条款：按 A–F 六类逐项核查"},
        {"date": "2026-10-25", "kind": "lint", "text": "修复简称冲突（ACM FSE / FSE(IACR) 改按 uid 合并）；投稿上限统一口径"},
        {"date": "2026-10-25", "kind": "verify", "text": "波次4 缺口重查：30 天内截稿的 12 个会议；S&P 补到每轮 6 篇上限与 ORCID 要求"},
        {"date": "2026-10-25", "kind": "ingest", "text": f"接入 ccfddl 往届录用率（commit {acc_doc['commit'][:8]}），覆盖 {len(ACC)} 个会议"},
    ]
    with open(CHANGELOG, "w", encoding="utf-8") as f:
        for e in seed:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
LOG = [json.loads(l) for l in open(CHANGELOG, encoding="utf-8") if l.strip()]


def log_page():
    L = ["# 变更日志", "", "格式：`## [日期] 类型 | 内容`，新的在上。类型：ingest 纳入新资料 / verify 核查 / review 待审合并 / lint 体检修复。", ""]
    for e in reversed(LOG):
        L.append(f"## [{e['date']}] {e['kind']} | {e['text']}")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- 写盘
pages = {}
for r in rows:
    pages[r["uid"]] = {"type": "conference", "title": f"{r['abbr']} 2027", "md": conf_page(r), "path": f"conferences/{r['uid']}.md"}
for sub in DIR_ORDER:
    if sub in SUBS:
        pages[dir_id(sub)] = {"type": "direction", "title": SUBS[sub], "md": dir_page(sub), "path": f"directions/{dir_id(sub)}.md"}
for c in CONCEPTS:
    pages[c["id"]] = {"type": "concept", "title": c["title"], "md": concept_page(c), "path": f"concepts/{c['id']}.md"}
pages["index"] = {"type": "meta", "title": "索引", "md": index_page(), "path": "index.md"}
pages["log"] = {"type": "meta", "title": "变更日志", "md": log_page(), "path": "log.md"}

# ---- 体检（lint）：断链、孤立页、缺出处 ----
LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
inbound = Counter()
broken = []
for pid, pg in pages.items():
    for t in LINK_RE.findall(pg["md"]):
        if t not in pages:
            broken.append((pid, t))
        elif pid != "index":
            inbound[t] += 1
orphans = [pid for pid, pg in pages.items() if pg["type"] != "meta" and inbound[pid] == 0]
no_evidence = [r["abbr"] for r in rows if r["vstatus"] == "已核实" and not r["evidence"]]
lint = ["# 体检报告", "", f"生成于 {NOW_BJ:%Y-%m-%d %H:%M}（北京）", "",
        f"- 断链：{len(broken)}" + ("".join(f"\n  - {a} → {b}" for a, b in broken)),
        f"- 孤立页（除索引外无入链）：{len(orphans)}" + (f"：{'、'.join(orphans)}" if orphans else ""),
        f"- 标为已核实但缺出处：{len(no_evidence)}" + (f"：{'、'.join(no_evidence)}" if no_evidence else ""),
        f"- 有信息缺口的会议：{sum(1 for r in rows if r['gap'])}（明细见各会议页「信息缺口」或 Excel「待补清单」）",
        f"- 2027 CFP 未发布：{sum(1 for r in rows if r['vstatus'] == '2027CFP未发布')}（CFP 集中发布期需重查）"]
pages["lint"] = {"type": "meta", "title": "体检报告", "md": "\n".join(lint) + "\n", "path": "LINT.md"}

for sub in ("conferences", "directions", "concepts"):
    shutil.rmtree(os.path.join(W, sub), ignore_errors=True)
    os.makedirs(os.path.join(W, sub), exist_ok=True)
for pid, pg in pages.items():
    # 页面内 [[id]] 在 Obsidian 等工具里按文件名解析，故文件名即 id
    with open(os.path.join(W, pg["path"]), "w", encoding="utf-8") as f:
        f.write(pg["md"])

# ---------------------------------------------------------------- 站点数据包
nodes, edges = [], []
for r in rows:
    nodes.append({"id": r["uid"], "type": "conference", "label": r["abbr"], "ccf": r["ccf"], "dir": dir_id(r["sub"])})
    edges.append({"s": r["uid"], "t": dir_id(r["sub"]), "rel": "方向"})
    for c in r["concepts"]:
        edges.append({"s": r["uid"], "t": c, "rel": CONCEPT_BY_ID[c]["title"], "dense": CONCEPT_BY_ID[c]["dense"]})
    for u in COLO.get(r["uid"], []):
        if r["uid"] < u:
            edges.append({"s": r["uid"], "t": u, "rel": "同期同地"})
for sub in DIR_ORDER:
    if sub in SUBS:
        nodes.append({"id": dir_id(sub), "type": "direction", "label": SUBS[sub]})
for c in CONCEPTS:
    nodes.append({"id": c["id"], "type": "concept", "label": c["title"], "dense": c["dense"]})

confs = []
for r in rows:
    confs.append({
        "uid": r["uid"], "abbr": r["abbr"], "full": r["full"], "ccf": r["ccf"], "dir": SUBS[r["sub"]],
        "dir_id": dir_id(r["sub"]), "topic": r["topic"], "rounds": r["rounds_bj"],
        "decv": r.get("decision_v") or "", "tz": r["tz"], "date": r["date_text"], "place": r["place"],
        "link": r["link"], "fmt": r["format"], "onsite": r["onsite"], "remote": r["remote"],
        "al_n": r["al_n"], "al": r["al_disp"], "nb_status": r["nb_status"], "nb_impact": r["nb_impact"],
        "nb_hard": r["nb_hard"], "nb_soft": r["nb_soft"], "nb_cap": r["nb_cap"],
        "vstatus": r["vstatus"], "conf": r["conf_final"], "gap": r["gap"], "gap_kind": r["gap_kind"],
        "concepts": r["concepts"],
        "acc": [{"y": a["year"], "r": round(a["rate"], 4) if isinstance(a.get("rate"), (int, float)) else None}
                for a in ACC.get(r["uid"], [])[-3:]],
    })

bundle = {
    "generated": f"{NOW_BJ:%Y-%m-%d %H:%M}",
    "counts": {"conferences": len(rows), "pages": len(pages), "edges": len(edges)},
    "pages": {pid: {"type": pg["type"], "title": pg["title"], "md": pg["md"]} for pid, pg in pages.items()},
    "confs": confs, "nodes": nodes, "edges": edges,
}
os.makedirs(SITE_DATA, exist_ok=True)
with open(os.path.join(SITE_DATA, "wiki.json"), "w", encoding="utf-8") as f:
    json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
# 倒计时看板由 build_html.py 直接写入 site/（site/dashboard.html 是手写页面，这里不再覆盖）

print(f"wiki: {len(pages)} 页（会议 {len(rows)} / 方向 {sum(p['type'] == 'direction' for p in pages.values())} / "
      f"概念 {len(CONCEPTS)}）；关系 {len(edges)} 条；同期同地组 {sum(1 for g in colo.values() if len(g) > 1)}")
print(f"lint: 断链 {len(broken)} / 孤立页 {len(orphans)} / 已核实缺出处 {len(no_evidence)}")
print(f"bundle: {os.path.getsize(os.path.join(SITE_DATA, 'wiki.json')) / 1024:.0f} KB")

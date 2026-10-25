# -*- coding: utf-8 -*-
"""合并 波次1(知识补全) + 波次2(官网核查) + 波次3(新人条款) + 波次4(缺口重查) -> merged.json + Excel"""
import json, glob, os, re, datetime
from collections import Counter
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import CellIsRule, FormulaRule

D = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(os.path.join(D, "base_2027.json"), encoding="utf-8"))
BY_UID = {r["uid"]: r for r in rows}
BY_KEY = {(r["abbr_raw"], r["full"]): r["uid"] for r in rows}
ABBR_CNT = Counter(r["abbr_raw"] for r in rows)
BY_ABBR = {r["abbr_raw"]: r["uid"] for r in rows if ABBR_CNT[r["abbr_raw"]] == 1}


def load_wave(out_dir, slice_dir=None, merge=False):
    """读取一个波次的产出，按 uid 归档。
    产出项只带 abbr，靠同名切片文件逐位置对齐拿到 (abbr, full) -> uid；
    这样同简称的两个会（如 ACM FSE / IACR FSE）不会互相覆盖。"""
    out, bad, pending = {}, [], []
    files = sorted(glob.glob(os.path.join(D, out_dir, "*.json")))
    for fp in files:
        name = os.path.basename(fp)
        try:
            arr = json.load(open(fp, encoding="utf-8-sig"))
        except Exception as e:
            bad.append((name, str(e)[:60])); continue
        if isinstance(arr, dict):
            arr = list(arr.values())
        sl = []
        if slice_dir:
            sp = os.path.join(D, slice_dir, name)
            if os.path.exists(sp):
                sl = json.load(open(sp, encoding="utf-8-sig"))
        for i, it in enumerate(arr):
            if not isinstance(it, dict) or not it.get("abbr") and not it.get("uid"):
                continue
            abbr = (it.get("abbr") or "").strip()
            uid = (it.get("uid") or "").strip()
            if not uid and i < len(sl) and sl[i].get("abbr", "").strip() == abbr:
                uid = BY_KEY.get((abbr, sl[i].get("full", "").strip()), "")
            if not uid:
                uid = BY_ABBR.get(abbr, "")
            if uid not in BY_UID:
                bad.append((name, f"#{i} {abbr} 无法定位到唯一会议"))
                continue
            if merge:
                pending.append((str(it.get("checked") or ""), name, i, uid, it))
                continue
            if uid in out:
                bad.append((name, f"#{i} {abbr} 重复"))
            out[uid] = it
    for *_, uid, it in sorted(pending, key=lambda x: x[:3]):
        cur = out.setdefault(uid, {})
        for k, v in it.items():
            if v not in ("", None):
                cur[k] = v
    return out, files, bad


enrich, efiles, ebad = load_wave("enrich", "slices")
verify, vfiles, vbad = load_wave("verify", "verify_slices")
newbie, nbfiles, nbbad = load_wave("newbie", "newbie_slices")
recheck, rfiles, rbad = load_wave("recheck", "recheck_slices", merge=True)
for name, w, f, b in (("波次1 enrich", enrich, efiles, ebad), ("波次2 verify", verify, vfiles, vbad),
                      ("波次3 newbie", newbie, nbfiles, nbbad), ("波次4 recheck", recheck, rfiles, rbad)):
    print(f"{name}: {len(w)} 条 / {len(f)} 文件" + (f"  问题:{b}" if b else ""))

DEF = {"topic": "待补充", "format": "待确认", "onsite": "待确认", "remote": "待确认",
       "author_limit": "待确认", "newbie": "待确认", "pages": "待确认", "blind": "待确认",
       "system": "待确认", "conf": "低", "note": ""}
NB_KEYS = ("nb_review", "nb_quota", "nb_senior", "nb_account", "nb_track", "nb_fee", "nb_conf", "nb_note")


def derive_format(place, cur):
    if cur and cur not in ("待确认",):
        return cur
    p = (place or "").lower()
    has_online = ("virtual" in p) or ("online" in p)
    has_place = any(ch.isalpha() for ch in p) and len(p) > 8 and not p.startswith("virtual")
    if has_online and has_place:
        return "混合"
    if has_online:
        return "纯线上"
    return "线下"


def parse_limit(t):
    """作者投稿上限 -> 统一结构 {n: 篇数或 None, scope: 口径, disp: 统一写法}"""
    t = (t or "").strip()
    if t in ("", "待确认", "未找到", "未知"):
        return {"n": None, "scope": "", "disp": "待确认"}
    if t == "不限":
        return {"n": None, "scope": "", "disp": "不限"}
    year = re.search(r"全年\s*(\d+)\s*篇", t)
    month = re.search(r"每月\s*(\d+)\s*篇", t)
    if year:
        n = int(year.group(1))
        scope = "每年" + (f"（每月≤{month.group(1)}）" if month else "")
        return {"n": n, "scope": scope, "disp": f"{n} 篇/年" + (f"（每月≤{month.group(1)}）" if month else "")}
    if "配额" in t:
        m = re.search(r"(\d+)\s*篇", t)
        n = int(m.group(1)) if m else None
        return {"n": n, "scope": "配额制", "disp": f"{n} 篇起（按合著人数配额）" if n else t}
    m = re.search(r"(\d+)\s*篇\s*/\s*(轮|周期)", t)
    if m:
        n = int(m.group(1))
        return {"n": n, "scope": "每轮", "disp": f"{n} 篇/轮"}
    m = re.search(r"(\d+)\s*篇", t)
    if m:
        n = int(m.group(1))
        return {"n": n, "scope": "每届", "disp": f"{n} 篇/届"}
    return {"n": None, "scope": "其他", "disp": t}


def bj(s):
    return datetime.datetime.strptime(s, "%Y-%m-%d %H:%M") if s else None


NA = {"", "无", "无门槛", "无审稿义务", "未提及", "待确认", "未找到", "未知", "—", "None", "不强制"}

for r in rows:
    uid = r["uid"]
    e = enrich.get(uid, {})
    for k, v in DEF.items():
        val = e.get(k)
        val = val.strip() if isinstance(val, str) else (val if val is not None else "")
        r[k] = val if val else v
    r["format"] = derive_format(r["place"], r.get("format"))
    # 每个字段来自哪一轮：知识补全（未核实）/ 官网核查 / 新人条款核查 / 缺口重查
    prov = {k: "知识补全" for k in DEF}
    prov["format"] = "ccfddl 地点推断" if not e.get("format") or e.get("format") == "待确认" else "知识补全"

    v = verify.get(uid, {})
    r["vstatus"] = (v.get("vstatus") or "未核查").strip()
    r["evidence"] = (v.get("evidence") or "").strip()
    r["vnote"] = (v.get("vnote") or "").strip()
    if r["vstatus"] == "已核实":
        for k in ("onsite", "remote", "author_limit", "newbie"):
            nv = (v.get(k) or "").strip()
            if nv and nv != "待确认":
                r[k] = nv
                prov[k] = "官网核查"
        # 核查到的录用通知优先（仅对单轮会议有意义）
        if (v.get("decision") or "").strip():
            r["decision_v"] = v["decision"].strip()
    r["conf_final"] = {"已核实": "高"}.get(r["vstatus"], r.get("conf", "低"))

    # ---- 波次3 新人作者专属条款 ----
    nb = newbie.get(uid, {})
    r["nb_status"] = (nb.get("nb_status") or "").strip()
    for k in NB_KEYS:
        val = nb.get(k)
        r[k] = val.strip() if isinstance(val, str) else ""
    r["nb_evidence"] = (nb.get("evidence") or "").strip()
    if r["nb_status"]:
        prov["nb"] = "新人条款核查"

    # ---- 波次4 缺口重查：只覆盖查到了确定结论的字段 ----
    rc = recheck.get(uid, {})
    r["rc_evidence"] = (rc.get("evidence") or "").strip()
    r["rc_note"] = (rc.get("rc_note") or "").strip()
    if rc:
        if (rc.get("vstatus") or "").strip() == "已核实" and r["vstatus"] != "已核实":
            r["vstatus"], r["conf_final"] = "已核实", "高"
            r["evidence"] = r["rc_evidence"] or r["evidence"]
        for k in ("onsite", "remote", "author_limit"):
            nv = (rc.get(k) or "").strip()
            if nv and nv not in ("待确认", "未找到"):
                r[k] = nv
                prov[k] = "缺口重查"
        st = (rc.get("nb_status") or "").strip()
        if st in ("有专属条款", "无专属条款"):
            r["nb_status"] = st
        # 新人条款逐字段覆盖：待审区单条修改也能生效
        got = [k for k in NB_KEYS if isinstance(rc.get(k), str) and rc[k].strip()]
        for k in got:
            r[k] = rc[k].strip()
        if st in ("有专属条款", "无专属条款") or got:
            r["nb_evidence"] = r["rc_evidence"] or r["nb_evidence"]
            prov["nb"] = "缺口重查"
    r["prov"] = prov

    if not r["nb_status"]:
        if r["vstatus"] == "2027CFP未发布":
            r["nb_status"] = "CFP未发布"
        elif r["vstatus"] in ("官网不可达", "未找到"):
            r["nb_status"] = "未找到"
        else:
            r["nb_status"] = "未核查"

    # 「（全体作者）」易被读成合著者共享配额；原意是每位作者各自的上限，统一改写
    r["nb_quota"] = re.sub(r"（(全体作者|全作者统一上限)）", "（每位作者各自计，适用于所有作者）", r["nb_quota"])

    hard, soft = [], []
    if r["nb_review"] not in NA:
        hard.append(r["nb_review"])
    if r["nb_quota"] not in NA:
        hard.append("配额 " + r["nb_quota"])
    if r["nb_senior"] == "必须挂资深作者":
        hard.append("须挂资深作者")
    # D 类只认「投稿时」的门槛；录用后走出版流程的 ORCID/版权要求不算
    acc = r["nb_account"]
    if acc not in NA and not any(w in acc for w in ("录用", "接收", "出版", "camera", "Camera", "终稿")):
        hard.append(acc)
    if r["nb_track"] not in NA:
        soft.append("通道 " + r["nb_track"])
    if r["nb_fee"] not in NA:
        soft.append(r["nb_fee"])

    if r["nb_status"] == "有专属条款":
        if hard:
            r["nb_impact"] = "有硬性要求"
            r["nb_summary"] = "硬性｜" + hard[0]
        elif soft:
            r["nb_impact"] = "只有利好通道"
            r["nb_summary"] = "利好｜" + soft[0]
        else:
            r["nb_impact"] = "仅奖项"
            r["nb_summary"] = "仅奖项"
    elif r["nb_status"] == "无专属条款":
        r["nb_impact"] = "无"
        r["nb_summary"] = "无专属条款"
    else:
        r["nb_impact"] = r["nb_status"]
        r["nb_summary"] = r["nb_status"]
    r["nb_hard"] = "；".join(hard)
    r["nb_soft"] = "；".join(soft)

    # ---- 作者投稿上限：统一成 篇数 + 口径 ----
    lim = parse_limit(r.get("author_limit"))
    r["al_n"], r["al_scope"], r["al_disp"] = lim["n"], lim["scope"], lim["disp"]

    # ---- 首投者实际可投篇数：新人配额只是复述全体上限时不重复写 ----
    nq = str(r["nb_quota"] or "").strip()
    has_nq = nq not in NA
    if has_nq and lim["n"] is not None and set(re.findall(r"\d+", nq)) <= set(re.findall(r"\d+", r["author_limit"])):
        has_nq = False
    if has_nq and lim["n"] is not None:
        r["nb_cap"] = f"{nq}；全体上限 {lim['disp']}"
    elif has_nq:
        r["nb_cap"] = nq
    else:
        r["nb_cap"] = lim["disp"]

    # ---- 轮次（北京时间，到分钟），供 Excel 公式与看板实时选轮 ----
    rr = []
    for k, x in enumerate(r["rounds"], 1):
        label = x["comment"] or ("单轮" if r["round_count"] == 1 else f"第{k}轮")
        rr.append({"l": label, "abs": x.get("abs_bj", ""), "dl": x.get("dl_bj", ""),
                   "reb": x.get("reb_bj", ""), "dec": x.get("dec_bj", "")})
    r["rounds_bj"] = rr

# 备注合成
for r in rows:
    parts = []
    if r.get("note"):
        parts.append(r["note"])
    if r.get("vnote"):
        parts.append("核查:" + r["vnote"])
    if r.get("rc_note"):
        parts.append("重查:" + r["rc_note"])
    if r["round_count"] > 1:
        seq = " / ".join(f"{x['comment'] or '轮'}:{x['dl'] or '—'}" for x in r["rounds"])
        parts.append("全部轮次 " + seq)
    r["note_final"] = "；".join(parts)

# ---- 信息缺口：缺什么、为什么缺、下一步 ----
for r in rows:
    miss = []
    if not r["full_dl"]:
        miss.append("截稿日")
    if r["onsite"] == "待确认":
        miss.append("是否到场")
    if r["nb_status"] in ("未找到", "未核查", "CFP未发布"):
        miss.append("新人条款")
    r["gap"] = "、".join(miss)
    if not miss:
        r["gap_kind"], r["gap_action"] = "", ""
    elif r["vstatus"] == "2027CFP未发布":
        r["gap_kind"] = "等官方发布"
        r["gap_action"] = "2027 CFP 未出，发布后重查；不要沿用上届"
    elif r["vstatus"] in ("未找到", "官网不可达", "未核查"):
        r["gap_kind"] = "官网未查到"
        r["gap_action"] = "换入口重查（官网 / dblp / 主办方页面）"
    else:
        r["gap_kind"] = "官网未写明"
        r["gap_action"] = "查 Registration / Attending / FAQ / Reviewing 子页"

json.dump(rows, open(os.path.join(D, "merged.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

# ======================================================================
# Excel
# ======================================================================
NAVY = "1F3552"; ACCENT = "2D6A9F"
HDR_FILL = PatternFill("solid", fgColor=NAVY)
HDR_FONT = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
BODY = Font(name="微软雅黑", size=9.5, color="22303C")
BOLD = Font(name="微软雅黑", size=9.5, bold=True, color="22303C")
MONO = Font(name="Consolas", size=9.5, color="1A4E7A")
THIN = Side(style="thin", color="D8DEE6")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
BAND = PatternFill("solid", fgColor="F5F8FB")
DT_FMT = "yyyy-mm-dd hh:mm"

wb = Workbook()


def style_header(ws, ncol, row=1, height=36):
    for c in range(1, ncol + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HDR_FILL; cell.font = HDR_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[row].height = height


ws = wb.active
ws.title = "2027 会议主表"

# 隐藏表：每行一个会议，存全部轮次（北京时间）。主表多轮会议用公式按 NOW() 选最近未过期轮次
K = max(r["round_count"] for r in rows) or 1
wr = wb.create_sheet("_轮次")
wr.sheet_state = "hidden"
BLK = {"dl": 2, "abs": 2 + K, "reb": 2 + 2 * K, "dec": 2 + 3 * K, "l": 2 + 4 * K}
# Excel 的 NOW() 是电脑本地时间；截稿时间是北京时间，故统一经「读我」B3 的电脑时区换算成北京时间
TZ_CELL = "'读我'!$B$3"
NOW = "'_轮次'!$A$1"
wr.cell(row=1, column=1, value=f"=NOW()+(8-{TZ_CELL})/24").number_format = DT_FMT
for name, start in BLK.items():
    for k in range(K):
        wr.cell(row=1, column=start + k, value=f"{name}{k + 1}")
for i, r in enumerate(rows, 2):
    wr.cell(row=i, column=1, value=r["uid"])
    for k, x in enumerate(r["rounds_bj"]):
        for name in ("dl", "abs", "reb", "dec"):
            if x[name]:
                c = wr.cell(row=i, column=BLK[name] + k, value=bj(x[name]))
                c.number_format = DT_FMT
        wr.cell(row=i, column=BLK["l"] + k, value=x["l"])


def rng(name, i):
    a = get_column_letter(BLK[name]); b = get_column_letter(BLK[name] + K - 1)
    return f"'_轮次'!${a}${i}:${b}${i}"


COLS = [
    ("序号", 5), ("简称", 14), ("全称", 44), ("研究主题", 38), ("方向", 17), ("CCF", 5),
    ("摘要截稿\n(北京)", 15), ("正文截稿\n(北京)", 15), ("轮次", 14), ("原始时区", 9),
    ("Rebuttal\n(北京)", 15), ("录用通知\n(北京)", 15), ("状态", 8), ("剩余\n天数", 7),
    ("会期", 21), ("地点", 24), ("举办形式", 9), ("是否必须到场", 12), ("远程参会", 22),
    ("投稿上限\n(篇)", 9), ("上限口径", 14), ("新人作者条款", 24), ("官网核查", 13),
    ("信息缺口", 16), ("官网", 30), ("备注", 34),
]
CI = {name.split("\n")[0]: j for j, (name, _) in enumerate(COLS, 1)}
L = {k: get_column_letter(v) for k, v in CI.items()}
ws.append([c[0] for c in COLS])
style_header(ws, len(COLS))

for i, r in enumerate(rows, 2):
    multi = r["round_count"] > 1
    H = f"{L['正文截稿']}{i}"
    R = rng("dl", i)
    if multi:
        pos = f"MATCH({H},{R},0)"

        def pick(name, i=i, pos=pos):
            return (f'=IF(ISNUMBER({H}),IF(N(INDEX({rng(name, i)},{pos}))=0,"—",'
                    f'INDEX({rng(name, i)},{pos})),"—")')
        dl = (f'=IF(COUNT({R})=0,"待公布",IF(COUNTIF({R},">"&{NOW})>0,'
              f'SMALL({R},COUNTIF({R},"<="&{NOW})+1),MAX({R})))')
        ab, reb, dec = pick("abs"), pick("reb"), pick("dec")
        lab = f'=IF(ISNUMBER({H}),INDEX({rng("l", i)},{pos}),"—")'
    else:
        x = r["rounds_bj"][0] if r["rounds_bj"] else {}
        dl = bj(x.get("dl")) or "待公布"
        ab = bj(x.get("abs")) or "—"
        reb = bj(x.get("reb")) or "—"
        dec = r.get("decision_v") or bj(x.get("dec")) or "待公布"
        lab = r["round_label"] or "—"
    status = f'=IF(ISNUMBER({H}),IF({H}>{NOW},"未截止","已截止"),"TBD")'
    days = f'=IF(ISNUMBER({H}),IF({H}>{NOW},INT({H}-{NOW}),"—"),"—")'
    ws.append([
        r["idx"], r["abbr"], r["full"], r["topic"], r["sub_cn"], r["ccf"],
        ab, dl, lab, r["tz"] or "—", reb, dec, status, days,
        r["date_text"], r["place"], r["format"], r["onsite"], r["remote"],
        r["al_n"] if r["al_n"] is not None else r["al_disp"], r["al_scope"] or "—",
        r["nb_summary"], r["vstatus"], r["gap"] or "—", r["link"], r["note_final"],
    ])

nrow = ws.max_row
DT_COLS = {CI["摘要截稿"], CI["正文截稿"], CI["Rebuttal"], CI["录用通知"]}
CENTER = {CI[k] for k in ("序号", "方向", "CCF", "原始时区", "状态", "剩余", "举办形式", "投稿上限", "上限口径", "官网核查")}
WRAP = {CI[k] for k in ("全称", "研究主题", "地点", "远程参会", "新人作者条款", "信息缺口", "备注")}
for i in range(2, nrow + 1):
    for c in range(1, len(COLS) + 1):
        cell = ws.cell(row=i, column=c)
        cell.font = MONO if c in DT_COLS else BODY
        cell.border = BORDER
        if c in DT_COLS:
            cell.number_format = DT_FMT
        cell.alignment = Alignment(vertical="center",
                                   horizontal="center" if c in CENTER else "left",
                                   wrap_text=c in WRAP)
    if i % 2 == 0:
        for c in range(1, len(COLS) + 1):
            ws.cell(row=i, column=c).fill = BAND
    ws.row_dimensions[i].height = 32
    ws.cell(row=i, column=2).font = BOLD

for j, (_, w) in enumerate(COLS, 1):
    ws.column_dimensions[get_column_letter(j)].width = w

ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}{nrow}"


def cf(sheet, col, n, rules):
    area = f"{col}2:{col}{n}"
    for op, formula, bg, fg, bold in rules:
        sheet.conditional_formatting.add(area, CellIsRule(
            operator=op, formula=formula,
            fill=PatternFill("solid", fgColor=bg),
            font=Font(name="微软雅黑", size=9.5, bold=bold, color=fg)))


cf(ws, L["状态"], nrow, [("equal", ['"已截止"'], "E8ECF1", "8A96A3", False),
                         ("equal", ['"未截止"'], "E3F2E8", "1E7B45", True),
                         ("equal", ['"TBD"'], "FDF1DC", "9A6212", False)])
# 剩余天数是公式结果，"—" 为文本，用 ISNUMBER 防止文本被当成大数
d0 = f"{L['剩余']}2"
for formula, bg, fg in ((f"AND(ISNUMBER({d0}),{d0}<=30)", "FBE0E0", "B3261E"),
                        (f"AND(ISNUMBER({d0}),{d0}>30,{d0}<=90)", "FDEFDC", "A55A0B")):
    ws.conditional_formatting.add(f"{L['剩余']}2:{L['剩余']}{nrow}", FormulaRule(
        formula=[formula], fill=PatternFill("solid", fgColor=bg),
        font=Font(name="微软雅黑", size=9.5, bold=True, color=fg)))
cf(ws, L["官网核查"], nrow, [("equal", ['"已核实"'], "DCEFE2", "1E7B45", True),
                             ("equal", ['"2027CFP未发布"'], "FDF1DC", "9A6212", False),
                             ("equal", ['"未核查"'], "F0F0F0", "9AA0A6", False)])

for i in range(2, nrow + 1):
    v = ws.cell(row=i, column=CI["CCF"]).value
    color = {"A": ("FCE4E4", "9C1F1F"), "B": ("FDF0DC", "8A5A10"),
             "C": ("E7F0FA", "1D4E7E"), "N": ("EEF0F2", "6B7480")}.get(v)
    if color:
        ws.cell(row=i, column=CI["CCF"]).fill = PatternFill("solid", fgColor=color[0])
        ws.cell(row=i, column=CI["CCF"]).font = Font(name="微软雅黑", size=10, bold=True, color=color[1])

# ---- Sheet2 扩展规则 ----
ws2 = wb.create_sheet("扩展规则")
C2 = [("序号", 5), ("简称", 14), ("CCF", 5), ("页数限制", 16), ("盲审", 9),
      ("投稿系统", 14), ("CORE", 8), ("THCPL", 8), ("作者投稿上限（原文）", 22), ("官网核查", 13),
      ("核查依据", 44), ("备注", 40)]
ws2.append([c[0] for c in C2])
style_header(ws2, len(C2))
for r in rows:
    ws2.append([r["idx"], r["abbr"], r["ccf"], r["pages"], r["blind"], r["system"],
                r["core"] or "—", r["thcpl"] or "—", r["author_limit"], r["vstatus"],
                r["evidence"] or "—", r["note_final"]])
for i in range(2, ws2.max_row + 1):
    for c in range(1, len(C2) + 1):
        cell = ws2.cell(row=i, column=c)
        cell.font = BODY; cell.border = BORDER
        cell.alignment = Alignment(vertical="center",
                                   horizontal="center" if c in (1, 3, 5, 7, 8, 10) else "left",
                                   wrap_text=c in (9, 11, 12))
    ws2.row_dimensions[i].height = 28
    ws2.cell(row=i, column=2).font = BOLD
for j, (_, w) in enumerate(C2, 1):
    ws2.column_dimensions[get_column_letter(j)].width = w
ws2.freeze_panes = "C2"
ws2.auto_filter.ref = f"A1:{get_column_letter(len(C2))}{ws2.max_row}"

print("主表/扩展规则 完成，行数 =", nrow - 1)

# ---- Sheet 新人作者要求 ----
wsn = wb.create_sheet("新人作者要求")
CN = [("序号", 5), ("简称", 14), ("CCF", 5), ("方向", 17), ("条款状态", 13),
      ("对首投的影响", 14), ("首投可投篇数", 24),
      ("审稿义务 / 互惠审稿", 34), ("首投配额", 17), ("资深作者要求", 13),
      ("投稿账号门槛", 26), ("学生 / 新人通道", 24), ("费用与资助", 20),
      ("依据 URL", 40), ("置信度", 8), ("备注", 30)]
wsn.append([c[0] for c in CN])
style_header(wsn, len(CN))

for r in rows:
    wsn.append([
        r["idx"], r["abbr"], r["ccf"], r["sub_cn"], r["nb_status"], r["nb_impact"],
        r["nb_cap"] or "—",
        r["nb_review"] or "—", r["nb_quota"] or "—", r["nb_senior"] or "—",
        r["nb_account"] or "—", r["nb_track"] or "—", r["nb_fee"] or "—",
        r["nb_evidence"] or "—", r["nb_conf"] or "—", r["nb_note"] or "",
    ])

nn = wsn.max_row
for i in range(2, nn + 1):
    for c in range(1, len(CN) + 1):
        cell = wsn.cell(row=i, column=c)
        cell.font = BODY; cell.border = BORDER
        cell.alignment = Alignment(vertical="center",
                                   horizontal="center" if c in (1, 3, 5, 6, 9, 10, 15) else "left",
                                   wrap_text=c in (7, 8, 11, 12, 13, 14, 16))
    wsn.row_dimensions[i].height = 30
    wsn.cell(row=i, column=2).font = BOLD

for j, (_, w) in enumerate(CN, 1):
    wsn.column_dimensions[get_column_letter(j)].width = w
wsn.freeze_panes = "C2"
wsn.auto_filter.ref = f"A1:{get_column_letter(len(CN))}{nn}"

cf(wsn, "E", nn, [("equal", ['"有专属条款"'], "FDF0DC", "8A5A10", True),
                  ("equal", ['"无专属条款"'], "F0F2F5", "6B7480", False),
                  ("equal", ['"CFP未发布"'], "FAFBFD", "9AA4AF", False),
                  ("equal", ['"未找到"'], "FBEAE7", "9C1F1F", False)])
cf(wsn, "F", nn, [("equal", ['"有硬性要求"'], "FBE0E0", "B3261E", True),
                  ("equal", ['"只有利好通道"'], "E3F2E8", "1E7B45", False),
                  ("equal", ['"仅奖项"'], "EEF4FA", "1D4E7E", False),
                  ("equal", ['"无"'], "F0F2F5", "6B7480", False)])

n_nb_yes = sum(1 for r in rows if r["nb_status"] == "有专属条款")
n_nb_no = sum(1 for r in rows if r["nb_status"] == "无专属条款")
n_nb_np = sum(1 for r in rows if r["nb_status"] == "CFP未发布")
n_nb_nf = sum(1 for r in rows if r["nb_status"] == "未找到")
n_nb_hard = sum(1 for r in rows if r["nb_impact"] == "有硬性要求")

# ---- Sheet 待补清单：按「还能投、离截稿近、评级高」排序 ----
wsg = wb.create_sheet("待补清单")
CG = [("序号", 5), ("简称", 14), ("CCF", 5), ("状态", 8), ("剩余天数\n(生成时)", 10), ("缺什么", 20),
      ("缺口类型", 12), ("下一步", 40), ("官网核查", 13), ("官网", 36)]
wsg.append([c[0] for c in CG])
style_header(wsg, len(CG))
ORD = {"A": 0, "B": 1, "C": 2, "N": 3}
KIND_ORD = {"官网未写明": 0, "官网未查到": 1, "等官方发布": 2}
gaps = [r for r in rows if r["gap"]]
gaps.sort(key=lambda r: ({"未截止": 0, "TBD": 1, "已截止": 2}[r["status"]],
                         r["days_left"] if r["days_left"] is not None else 9999,
                         KIND_ORD.get(r["gap_kind"], 9), ORD.get(r["ccf"], 9)))
for r in gaps:
    wsg.append([r["idx"], r["abbr"], r["ccf"], r["status"],
                r["days_left"] if r["days_left"] is not None else "—",
                r["gap"], r["gap_kind"], r["gap_action"], r["vstatus"], r["link"]])
ng = wsg.max_row
for i in range(2, ng + 1):
    for c in range(1, len(CG) + 1):
        cell = wsg.cell(row=i, column=c)
        cell.font = BODY; cell.border = BORDER
        cell.alignment = Alignment(vertical="center", horizontal="center" if c in (1, 3, 4, 5, 7, 9) else "left",
                                   wrap_text=c in (6, 8))
    wsg.row_dimensions[i].height = 24
    wsg.cell(row=i, column=2).font = BOLD
for j, (_, w) in enumerate(CG, 1):
    wsg.column_dimensions[get_column_letter(j)].width = w
wsg.freeze_panes = "C2"
wsg.auto_filter.ref = f"A1:{get_column_letter(len(CG))}{ng}"
cf(wsg, "G", ng, [("equal", ['"官网未写明"'], "FDF0DC", "8A5A10", True),
                  ("equal", ['"官网未查到"'], "FBEAE7", "9C1F1F", True),
                  ("equal", ['"等官方发布"'], "F0F2F5", "6B7480", False)])
gap_cnt = Counter(r["gap_kind"] for r in gaps)

# ---- Sheet ARR：数据来自 arr_cycles.json，最近一轮高亮与过期提示均为实时公式 ----
arr = json.load(open(os.path.join(D, "arr_cycles.json"), encoding="utf-8"))
ws3 = wb.create_sheet("ARR 轮次")
ws3["A1"] = "ACL Rolling Review（ARR）滚动审稿轮次"
ws3["A1"].font = Font(name="微软雅黑", size=13, bold=True, color=NAVY)
ws3["A2"] = f"{arr['cadence']} 数据源：{arr['source']}（核对于 {arr['checked']}）"
ws3["A2"].font = Font(name="微软雅黑", size=9, color="6B7480")

H3 = ["Cycle", "投稿截止", "审稿人注册", "审稿意见截止", "作者回复期", "Meta-review 释出", "Cycle 结束"]
for j, h in enumerate(H3, 1):
    cell = ws3.cell(row=4, column=j, value=h)
    cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.border = BORDER
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
ws3.row_dimensions[4].height = 32

d = lambda s: datetime.datetime.strptime(s, "%Y-%m-%d") if s else None
first = 5
for i, cy in enumerate(arr["cycles"], first):
    vals = (cy["name"], d(cy["submission"]), d(cy["reviewer_reg"]), d(cy["reviews_due"]),
            cy["author_response"], d(cy["meta_release"]), d(cy["cycle_end"]))
    for j, v in enumerate(vals, 1):
        cell = ws3.cell(row=i, column=j, value=v)
        cell.font = MONO if j > 1 else BOLD
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")
        if isinstance(v, datetime.datetime):
            cell.number_format = "yyyy-mm-dd"
    ws3.row_dimensions[i].height = 24
last = first + len(arr["cycles"]) - 1
B = f"$B${first}:$B${last}"
# 最近一个尚未截止的 cycle 高亮
ws3.conditional_formatting.add(f"A{first}:G{last}", FormulaRule(
    formula=[f'AND($B{first}>=TODAY(),COUNTIFS({B},">="&TODAY(),{B},"<"&$B{first})=0)'],
    fill=PatternFill("solid", fgColor="FDF0DC")))
ws3.conditional_formatting.add(f"A{first}:G{last}", FormulaRule(
    formula=[f"$B{first}<TODAY()"], font=Font(name="Consolas", size=9.5, color="9AA4AF")))

msg_row = last + 2
ws3.cell(row=msg_row, column=1, value=(
    f'=IF(COUNTIF({B},">="&TODAY())=0,"⚠ 表内各 ARR cycle 的投稿日均已过，请核对 {arr["source"]} 后更新 arr_cycles.json 并重新生成",'
    f'"最近一轮 ARR 投稿截止："&TEXT(SMALL({B},COUNTIF({B},"<"&TODAY())+1),"yyyy-mm-dd")&"（高亮行）")'))
ws3.cell(row=msg_row, column=1).font = Font(name="微软雅黑", size=9.5, bold=True, color="9A6212")
ws3.merge_cells(start_row=msg_row, start_column=1, end_row=msg_row, end_column=7)
ws3.cell(row=msg_row + 1, column=1, value=arr.get("upcoming_note", ""))
ws3.cell(row=msg_row + 1, column=1).font = Font(name="微软雅黑", size=9, italic=True, color="9A6212")
ws3.merge_cells(start_row=msg_row + 1, start_column=1, end_row=msg_row + 1, end_column=7)
ws3.cell(row=msg_row + 1, column=1).alignment = Alignment(vertical="center", wrap_text=True)
ws3.row_dimensions[msg_row + 1].height = 26
if not any(d(cy["submission"]) >= datetime.datetime.now() for cy in arr["cycles"]):
    print("!! arr_cycles.json 中所有 cycle 已过期，请更新")

t0 = msg_row + 3
ws3.cell(row=t0, column=1, value="ARR 路径与可 commit 会议（2027 届）").font = Font(name="微软雅黑", size=11, bold=True, color=NAVY)
H4 = ["会议", "CCF", "会期 / 地点", "路径", "最近一轮截稿(北京)", "说明"]
for j, h in enumerate(H4, 1):
    cell = ws3.cell(row=t0 + 1, column=j, value=h)
    cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.border = BORDER
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

i = t0 + 2
for r in rows:
    if r["abbr"] in ("ACL", "NAACL", "EACL", "COLING", "EMNLP", "AACL"):
        vals = (r["abbr"], r["ccf"], f'{r["date_text"]} | {r["place"]}',
                r["round_label"], r["full_dl"] or "—",
                "先投 ARR 拿 meta-review，再 commit 到本会，非直接投稿")
        for j, v in enumerate(vals, 1):
            cell = ws3.cell(row=i, column=j, value=v)
            cell.font = BODY; cell.border = BORDER
            cell.alignment = Alignment(horizontal="center" if j in (1, 2, 5) else "left",
                                       vertical="center", wrap_text=j in (3, 6))
        ws3.row_dimensions[i].height = 28
        i += 1

for j, w in enumerate([14, 13, 13, 14, 20, 17, 13], 1):
    ws3.column_dimensions[get_column_letter(j)].width = w
ws3.column_dimensions["C"].width = 34
ws3.column_dimensions["F"].width = 46

# ---- Sheet 读我（所有数字均由数据现算） ----
ws4 = wb.create_sheet("读我")
ws4.column_dimensions["A"].width = 18
ws4.column_dimensions["B"].width = 100
ws4["A1"] = "CCF 推荐会议 2027 届投稿规划表"
ws4["A1"].font = Font(name="微软雅黑", size=16, bold=True, color=NAVY)

n_ok = sum(1 for r in rows if r["vstatus"] == "已核实")
n_np = sum(1 for r in rows if r["vstatus"] == "2027CFP未发布")
n_un = sum(1 for r in rows if r["vstatus"] not in ("已核实", "2027CFP未发布"))
tzc = Counter(r["tz"] for r in rows)
n_shift = sum(1 for r in rows if r["raw_dl"] and r["full_dl"] and r["raw_dl"][:10] != r["full_dl"][:10])
ccfc = Counter(r["ccf"] for r in rows)
NOW_BJ = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=8)
ws4["A2"] = (f"生成时间 {NOW_BJ:%Y-%m-%d %H:%M}（北京）　|覆盖 2027 届会议 {len(rows)} 个"
             f"（A {ccfc['A']} · B {ccfc['B']} · C {ccfc['C']} · N {ccfc['N']}）　|　"
             f"官网已核实 {n_ok}　未发布 {n_np}　未查到 {n_un}　|　"
             f"新人条款：有 {n_nb_yes}（其中硬性 {n_nb_hard}）　无 {n_nb_no}　CFP未发布 {n_nb_np}　未找到 {n_nb_nf}")
ws4["A2"].font = Font(name="微软雅黑", size=9.5, color="6B7480")
ws4["A3"] = "电脑时区 (UTC±h)"
ws4["A3"].font = Font(name="微软雅黑", size=10, bold=True, color="9A6212")
ws4["B3"] = 8  # 本地时区无法可靠探测（本机 Python 与 Windows 时区不一致），默认按北京电脑
ws4["B3"].font = Font(name="Consolas", size=11, bold=True, color="9A6212")
ws4["B3"].fill = PatternFill("solid", fgColor="FDF0DC")
ws4["B3"].alignment = Alignment(horizontal="left")
ws4["A4"] = "换算后北京时间"
ws4["A4"].font = Font(name="微软雅黑", size=10, bold=True, color="9A6212")
ws4["B4"] = f'=TEXT({NOW},"yyyy-mm-dd hh:mm")&"　← 与北京时间不符就改 B3"'
ws4["B4"].font = Font(name="Consolas", size=10, color="9A6212")

BLOCKS = [
    ("时间口径", "所有截稿、rebuttal、录用通知时间**已统一折算为北京时间（UTC+8）**，不是会议当地时间。"
                 f"本表 {tzc.get('AoE', 0)} 个会议用 AoE、{tzc.get('UTC-12', 0)} 个用 UTC-12，折北京时间需 +20 小时，"
                 f"共 {n_shift} 个会议的截稿日期因此顺延一天。要对照官网原文时请看「原始时区」列。"),
    ("剩余天数", "「正文截稿 / 状态 / 剩余天数」是公式，打开文件时按电脑当前时间实时计算。"
                 f"Excel 只能读到电脑本地时间，所以先用上方 B3「电脑时区」换算成北京时间再比较——"
                 "B3 默认 8（北京）；电脑不在北京时区就改成该电脑的 UTC 偏移，如美东填 -4（夏令时）/ -5，B4 会显示换算结果供核对。"
                 "多轮会议会自动跳到最近一个未过期轮次，摘要截稿、轮次、Rebuttal、录用通知随之切换。"
                 "「待补清单」里的剩余天数是生成时的快照，仅用于排序。"),
    ("方向标签", "10 个方向对应 CCF 目录的十大领域：人工智能、体系结构/并行/存储、计算机网络、"
                 "网络与信息安全、软件工程/系统软件、数据库/数据挖掘、计算机科学理论、图形学与多媒体、"
                 "人机交互与普适计算、交叉/综合/新兴。"),
    ("同名会议", "合并按会议唯一 ID 进行，不按简称。同简称会议中评级高的保留原简称，其余加后缀，"
                 "如 ACM FSE（软工 A）与 FSE(IACR)（密码学 B）。"),
    ("官网核查列", "【已核实】读到官方 2027 CFP，参会与投稿规则字段来自官方原文。\n"
                   "【2027CFP未发布】官网还没有 2027 的征稿说明——这是当前多数会议的真实状态，"
                   "不代表信息错误，代表现在查不到。\n"
                   "【官网不可达】会议官网打不开或链接失效。【未找到】官网上没找到对应页面。\n"
                   "【未核查】本轮未覆盖到，字段来自知识补全。"),
    ("置信度", "【高】官网已核实或 ccfddl 官方数据。【中】合理推断，投稿前需复核。【低】沿用上一届口径或推测。\n"
               "截稿时间另有一层风险：部分 2027 数据是按上届规律外推的（如 SIGMOD 2027 四轮日期与 2026 完全同月同日），"
               "官方 CFP 一出就会变。"),
    ("轮次取法", "存在未过期轮次时取最早一个未过期的，否则取最后一轮并标「已截止」。"
                 "多轮会议（SIGMOD、VLDB 等）的完整轮次已写进「备注」列。"),
    ("ARR 类", "ACL / NAACL / EACL / COLING 走 ACL Rolling Review 滚动审稿，不直接投稿。"
               "主表截稿是该会的 commit / submission 节点，真实投稿看 ARR cycle，见「ARR 轮次」表。"
               "ARR 日期存于 arr_cycles.json，全部过期时该表顶部会出现提示。"),
    ("作者投稿上限", "主表拆成「投稿上限(篇)」数字列 + 「上限口径」列（每届 / 每轮 / 每年 / 配额制），可直接用数字筛选。"
                     "按「同一作者在该届的投稿篇数硬性上限」理解，绝大多数会议不设上限，故填「不限」；"
                     "填「待确认」表示可能有规定但未核实。官方原文写法见「扩展规则」表。表内没有任何编造的数字。"),
    ("新人作者条款", "「新人作者」指三类人，条款各不相同：首次向该会投稿的作者、学生作者、无资深合作者的独立作者。\n"
                     "「新人作者要求」sheet 把条款拆成 6 类逐项核查：审稿义务/互惠审稿（A）、首投配额（B）、"
                     "是否强制挂资深作者（C）、投稿账号门槛（D，如 OpenReview 新账号须机构邮箱）、"
                     "学生与新人通道（E，如 SRW / Doctoral Consortium / Junior PC）、费用与资助（F）。\n"
                     "关键：「无专属条款」是查过且确实没有的结论，不是默认值；CFP 未发布的会一律标「CFP未发布」，不冒充「无」。\n"
                     "「对首投的影响」再分三档：有硬性要求（会卡住或拒稿）、只有利好通道（学生 track / 资助）、仅奖项。\n"
                     "D 类账号门槛只认「投稿时」的要求，录用后走出版流程的 ORCID、版权表单不计入，避免虚高。\n"
                     "最容易卡住首投的几条：ICLR 须指定作者审稿≥3 篇否则 desk reject、无合格互惠审稿人限投 1 篇；"
                     "OOPSLA / POPL 2027 新政要求每篇至少 1 名资深作者注册 reserve reviewer；"
                     "AISTATS 无四大 ML 会录用记录者限 3 篇、全体作者不合格则仅 1 篇；"
                     "MobiSys / SenSys 每篇须 1 位按非学生费率注册；CVPR 无机构邮箱的 OpenReview 新账号需等约两周。"),
    ("信息缺口", f"共 {len(gaps)} 个会议仍有字段待补，见「待补清单」：官网未写明 {gap_cnt.get('官网未写明', 0)}、"
                 f"官网未查到 {gap_cnt.get('官网未查到', 0)}、等官方发布 {gap_cnt.get('等官方发布', 0)}。"
                 "「等官方发布」的不要用上届口径填，等 CFP 出来再查；其余两类可按「下一步」列重查，"
                 "结果写入 recheck/ 目录后重新生成即可合并。"),
    ("建议动作", "1) 先按「未截止」+ 剩余天数 ≤90 筛，再按 CCF 评级与方向锁定 15–20 个目标。\n"
                 "2) 「官网核查」为「已核实」的行可直接用；其余投稿前必须点官网复核。\n"
                 "3) 每年 12 月至次年 3 月是 CFP 集中发布期，本表需定期刷新。"),
]
rr_ = 6
for title, body in BLOCKS:
    a = ws4.cell(row=rr_, column=1, value=title)
    a.font = Font(name="微软雅黑", size=10.5, bold=True, color=ACCENT)
    a.alignment = Alignment(vertical="top", wrap_text=True)
    a.border = Border(bottom=Side(style="hair", color="D8DEE6"))
    b = ws4.cell(row=rr_, column=2, value=body)
    b.font = Font(name="微软雅黑", size=9.5, color="22303C")
    b.alignment = Alignment(vertical="top", wrap_text=True)
    b.border = Border(bottom=Side(style="hair", color="D8DEE6"))
    lines = body.count("\n") + 1 + len(body) // 95
    ws4.row_dimensions[rr_].height = max(22, 16 * lines)
    rr_ += 1

# 隐藏轮次表放最后
wb.move_sheet("_轮次", offset=len(wb.sheetnames) - 1 - wb.sheetnames.index("_轮次"))
wb.active = 0
# 状态 / 剩余天数是公式，openpyxl 不写缓存值，要求打开时全量重算
from openpyxl.workbook.properties import CalcProperties
wb.calculation = CalcProperties(fullCalcOnLoad=True)

OUT = os.path.join(D, "CCF2027会议投稿规划表.xlsx")
wb.save(OUT)
print("saved:", OUT)
print(f"核查状态: 已核实 {n_ok} / 未发布 {n_np} / 未查到 {n_un}")
print(f"信息缺口: {len(gaps)} 个会议 {dict(gap_cnt)}")

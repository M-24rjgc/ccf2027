# -*- coding: utf-8 -*-
"""从 ccfddl allconf.json 抽取 2027 届会议 -> 中文方向标签 + 全部时间折北京时间"""
import json, datetime, os
from collections import Counter

D = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(D, "allconf.json")
OUT = os.path.join(D, "base_2027.json")

# CCF 十大方向（已按实际收录会议核对）
SUB_CN = {
    "AI": "人工智能",
    "DS": "体系结构/并行/存储",
    "NW": "计算机网络",
    "SC": "网络与信息安全",
    "SE": "软件工程/系统软件",
    "DB": "数据库/数据挖掘",
    "CT": "计算机科学理论",
    "CG": "图形学与多媒体",
    "HI": "人机交互与普适计算",
    "MX": "交叉/综合/新兴",
}

# ---- 时区 -> UTC 偏移小时 ----
def us_dst(dt):
    """美西夏令时：3 月第二个周日 02:00 起，11 月第一个周日 02:00 止"""
    def nth_sunday(y, m, n):
        d = datetime.date(y, m, 1)
        first = d + datetime.timedelta(days=(6 - d.weekday()) % 7)
        return first + datetime.timedelta(days=7 * (n - 1))
    y = dt.year
    start = datetime.datetime.combine(nth_sunday(y, 3, 2), datetime.time(2))
    end = datetime.datetime.combine(nth_sunday(y, 11, 1), datetime.time(2))
    return start <= dt < end

def tz_offset(tz, local_naive):
    """返回该时区相对 UTC 的偏移小时数"""
    t = (tz or "").strip().upper().replace(" ", "")
    if t in ("AOE", "UTC-12", "UTC-12:00"):
        return -12.0
    if t in ("UTC", "UTC+0", "UTC+00", "GMT", "UTC-0"):
        return 0.0
    if t in ("PT", "PST", "PDT", "US/PACIFIC", "AMERICA/LOS_ANGELES"):
        return -7.0 if us_dst(local_naive) else -8.0
    if t.startswith("UTC") and len(t) >= 5:
        body = t[3:]
        try:
            sign = -1 if body.startswith("-") else 1
            body = body.lstrip("+-")
            hh, _, mm = body.partition(":")
            return sign * (int(hh) + (int(mm) / 60 if mm else 0))
        except Exception:
            return None
    return None

def to_beijing(dt, tz):
    """当地时间 -> 北京时间；时区无法识别时返回 (None, False)"""
    if dt is None:
        return None, False
    off = tz_offset(tz, dt)
    if off is None:
        return None, False
    return dt + datetime.timedelta(hours=8 - off), True

def parse_dt(s):
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s, fmt)
        except Exception:
            pass
    return None

def fdt(dt):
    return dt.strftime("%Y-%m-%d %H:%M") if dt else ""

def fd(dt):
    return dt.strftime("%Y-%m-%d") if dt else ""

# 基准“现在”统一用北京时间
NOW_BJ = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=8)

data = json.load(open(SRC, encoding="utf-8"))
rows, dropped, tz_unknown = [], [], []

for rec in data:
    abbr = (rec.get("title") or "").strip()
    full = (rec.get("description") or "").strip()
    if not abbr or not full:
        dropped.append(abbr); continue
    hit = [c for c in rec.get("confs", []) if str(c.get("year")) == "2027"]
    if not hit:
        continue
    c = hit[0]
    tz = (c.get("timezone") or "").strip()

    rounds = []
    for t in (c.get("timeline") or []):
        loc = {
            "abstract": parse_dt(t.get("abstract_deadline")),
            "deadline": parse_dt(t.get("deadline")),
            "rebuttal": parse_dt(t.get("rebuttal_deadline")),
            "decision": parse_dt(t.get("decision_deadline")),
        }
        bj, ok = {}, {}
        for k, v in loc.items():
            bj[k], ok[k] = to_beijing(v, tz)
        rounds.append({
            "comment": (t.get("comment") or "").strip(),
            "loc": loc, "bj": bj, "ok": ok,
        })

    if not any(r["ok"].get("deadline") for r in rounds):
        if any(r["loc"].get("deadline") for r in rounds) or not rounds:
            tz_unknown.append((abbr, tz))

    valid = [r for r in rounds if r["ok"].get("deadline")]
    upcoming = [r for r in valid if r["bj"]["deadline"] > NOW_BJ]
    if upcoming:
        main = min(upcoming, key=lambda r: r["bj"]["deadline"]); status = "未截止"
    elif valid:
        main = max(valid, key=lambda r: r["bj"]["deadline"]); status = "已截止"
    else:
        main = None; status = "TBD"

    rank = rec.get("rank") or {}
    sub = (rec.get("sub") or "").strip()
    row = {
        "uid": (c.get("id") or "").strip() or f"{abbr}-2027",
        "abbr": abbr, "abbr_raw": abbr, "full": full, "sub": sub,
        "sub_cn": SUB_CN.get(sub, sub or "未分类"),
        "ccf": (rank.get("ccf") or "N").strip(),
        "core": (rank.get("core") or "").strip(),
        "thcpl": (rank.get("thcpl") or "").strip(),
        "conf_id": (c.get("id") or "").strip(),
        "link": (c.get("link") or "").strip(),
        "tz": tz,
        "date_text": (c.get("date") or "").strip(),
        "place": (c.get("place") or "").strip(),
        "round_count": len(rounds),
        # abs/dl/reb/dec 为北京时间日期；*_bj 为北京时间到分钟，供看板与 Excel 实时重算剩余天数
        "rounds": [{
            "comment": r["comment"],
            "abs": fd(r["bj"]["abstract"]), "dl": fd(r["bj"]["deadline"]),
            "reb": fd(r["bj"]["rebuttal"]), "dec": fd(r["bj"]["decision"]),
            "abs_bj": fdt(r["bj"]["abstract"]), "dl_bj": fdt(r["bj"]["deadline"]),
            "reb_bj": fdt(r["bj"]["rebuttal"]), "dec_bj": fdt(r["bj"]["decision"]),
        } for r in rounds],
        "abs_dl": fdt(main["bj"]["abstract"]) if main else "",
        "full_dl": fdt(main["bj"]["deadline"]) if main else "",
        "rebuttal": fdt(main["bj"]["rebuttal"]) if main else "",
        "decision": fdt(main["bj"]["decision"]) if main else "",
        "round_label": (main["comment"] if main else "") or ("单轮" if main else ""),
        "status": status,
        "days_left": (main["bj"]["deadline"] - NOW_BJ).days if (main and status == "未截止") else None,
        "raw_dl": main["loc"]["deadline"].strftime("%Y-%m-%d %H:%M") if main and main["loc"]["deadline"] else "",
    }
    rows.append(row)

order = {"A": 0, "B": 1, "C": 2, "N": 3}
rows.sort(key=lambda r: (order.get(r["ccf"], 9), r["sub"], r["abbr_raw"]))
for i, r in enumerate(rows, 1):
    r["idx"] = i

# ---- 简称冲突：评级最高的保留原简称，其余加后缀；合并一律按 uid，不再按简称 ----
# 已知冲突给人工后缀，未知冲突回退为「简称(uid)」，保证显示名唯一
DISAMBIG = {"iacr-fse27": "FSE(IACR)"}
by_abbr = {}
for r in rows:
    by_abbr.setdefault(r["abbr_raw"], []).append(r)
for abbr, grp in by_abbr.items():
    if len(grp) < 2:
        continue
    for r in grp[1:]:  # rows 已按评级排序，grp[0] 评级最高
        r["abbr"] = DISAMBIG.get(r["uid"], f"{abbr}({r['uid']})")
    print(f"!! 简称冲突 {abbr}: " + " / ".join(f"{r['abbr']}[{r['uid']}]" for r in grp))
assert len({r["uid"] for r in rows}) == len(rows), "uid 不唯一"
assert len({r["abbr"] for r in rows}) == len(rows), "显示简称不唯一"

json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print(f"产出 {len(rows)} 行 -> {OUT}")
print(f"基准时间（北京）: {NOW_BJ:%Y-%m-%d %H:%M}")
print("评级:", dict(Counter(r["ccf"] for r in rows)))
print("状态:", dict(Counter(r["status"] for r in rows)))
print("时区无法识别:", tz_unknown if tz_unknown else "无")
print()
print("=== 日期因折北京时间而跨天的样例（top 8）===")
n = 0
for r in rows:
    if not r["raw_dl"] or not r["full_dl"]:
        continue
    a, b = r["raw_dl"][:10], r["full_dl"][:10]
    if a != b:
        print(f"  {r['abbr']:16} {r['tz']:7} 本地 {a} → 北京 {b} {r['full_dl'][11:]}")
        n += 1
    if n >= 8:
        break
print(f"  ……共 {sum(1 for r in rows if r['raw_dl'] and r['full_dl'] and r['raw_dl'][:10]!=r['full_dl'][:10])} 个会议跨天")

# -*- coding: utf-8 -*-
"""倒计时看板：merged.json + accept_rates.json -> site/js/dashboard-data.js + 离线单文件版

站点版（site/dashboard.html + dashboard.css + js/dashboard.js）是手写的静态文件，符合 CSP（无内联脚本），
这里只生成数据文件，并给页面里的资源链接打上内容哈希。离线版把同一套 HTML/CSS/JS 内联成一个文件，双击即可打开。
"""
import json, os, re, datetime, hashlib, base64
from collections import Counter

D = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(D, "site")
rows = json.load(open(os.path.join(D, "merged.json"), encoding="utf-8"))
ACC = json.load(open(os.path.join(D, "accept_rates.json"), encoding="utf-8"))["rates"]

def s(d, k, default=""):
    v = d.get(k)
    return v if isinstance(v, str) else (default if v is None else v)

def acc(uid):
    out = []
    for a in ACC.get(uid, [])[-3:]:
        if isinstance(a.get("rate"), (int, float)):
            out.append({"y": a["year"], "r": round(a["rate"], 4), "s": a.get("submitted"), "a": a.get("accepted")})
    return out

# 状态 / 剩余天数 / 当前轮次不在这里定死，交给页面按访问时刻从 rounds 实时计算
data = []
for r in rows:
    data.append({
        "idx": r["idx"], "uid": r["uid"], "abbr": r["abbr"], "full": r["full"], "topic": s(r, "topic"),
        "dir": r["sub_cn"], "ccf": r["ccf"], "rounds": r["rounds_bj"], "decv": r.get("decision_v") or "",
        "tz": r["tz"] or "", "date": r["date_text"], "place": r["place"],
        "fmt": r["format"], "onsite": r["onsite"], "remote": s(r, "remote"),
        "aln": r["al_n"], "ald": r["al_disp"], "newbie": s(r, "newbie"), "vs": r["vstatus"],
        "link": r["link"], "note": r["note_final"], "conf": r["conf_final"],
        "nb": s(r, "nb_summary"), "nbs": s(r, "nb_status"), "gap": r["gap"], "gk": r["gap_kind"],
        "pages": s(r, "pages"), "blind": s(r, "blind"), "sys": s(r, "system"), "acc": acc(r["uid"]),
    })

DIRS_CN = ["人工智能", "体系结构/并行/存储", "计算机网络", "网络与信息安全", "软件工程/系统软件",
           "数据库/数据挖掘", "计算机科学理论", "图形学与多媒体", "人机交互与普适计算", "交叉/综合/新兴"]
dirs = sorted({d["dir"] for d in data})
dirs = [x for x in DIRS_CN if x in dirs] + [x for x in dirs if x not in DIRS_CN]
tzc = Counter(r["tz"] for r in rows)
MERGED_MTIME = os.path.getmtime(os.path.join(D, "merged.json"))
meta = {
    # merged.json 的修改时间（北京时间）：数据没变，重跑也不会改动输出
    "generated": datetime.datetime.fromtimestamp(MERGED_MTIME, datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M"),
    "aoe": tzc.get("AoE", 0) + tzc.get("UTC-12", 0),
    "shifted": sum(1 for r in rows if r["raw_dl"] and r["full_dl"] and r["raw_dl"][:10] != r["full_dl"][:10]),
}
bundle = {"meta": meta, "dirs": dirs, "confs": data}
DATA_JS = "window.CCF_DASH = " + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n"

def read(p):
    return open(os.path.join(SITE, p), encoding="utf-8").read()

def write(p, text):
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

write(os.path.join(SITE, "js", "dashboard-data.js"), DATA_JS)

# 资源链接带内容哈希，数据或样式一变，浏览器缓存就失效
html = read("dashboard.html")
assets = {"dashboard.css": read("dashboard.css"), "js/dashboard-data.js": DATA_JS, "js/dashboard.js": read("js/dashboard.js")}
for path, body in assets.items():
    h = hashlib.sha256(body.encode("utf-8")).hexdigest()[:10]
    html = re.sub(r'(["\'])' + re.escape(path) + r'(?:\?v=[^"\']*)?\1', lambda m: f'{m.group(1)}{path}?v={h}{m.group(1)}', html)
write(os.path.join(SITE, "dashboard.html"), html)

# 离线版仅允许内容哈希匹配的脚本，继续禁止联网、嵌入页面和表单提交。
inline_scripts = ["\n" + DATA_JS.replace("</", "<\\/") , "\n" + assets["js/dashboard.js"]]
script_hashes = " ".join("'sha256-" + base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode("ascii") + "'" for body in inline_scripts)
offline_csp = f"default-src 'none'; script-src {script_hashes}; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
offline = re.sub(r'(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)', lambda m: m[1] + offline_csp + m[2], html)
offline = re.sub(r'<link rel="stylesheet" href="dashboard\.css[^"]*">',
                 lambda m: "<style>\n" + assets["dashboard.css"] + "</style>", offline)
offline = re.sub(r'<script src="js/dashboard-data\.js[^"]*"></script>',
                 lambda m: "<script>\n" + DATA_JS.replace("</", "<\\/") + "</script>", offline)
offline = re.sub(r'<script src="js/dashboard\.js[^"]*"></script>',
                 lambda m: "<script>\n" + assets["js/dashboard.js"] + "</script>", offline)
OUT = os.path.join(D, "CCF2027投稿倒计时看板.html")
write(OUT, offline)

n = len(data)
ccfc = Counter(d["ccf"] for d in data)
print("saved:", os.path.join(SITE, "js", "dashboard-data.js"), f"{len(DATA_JS) / 1024:.0f} KB")
print("saved:", OUT, f"{os.path.getsize(OUT) / 1024:.0f} KB")
print(f"统计: 总 {n}（" + " · ".join(f"{k} {ccfc[k]}" for k in "ABCN" if ccfc[k]) +
      f"）/ 已核实 {sum(d['vs'] == '已核实' for d in data)} / 新人条款 {sum(d['nbs'] == '有专属条款' for d in data)}"
      f" / 待补 {sum(bool(d['gap']) for d in data)} / 录用率 {sum(bool(d['acc']) for d in data)} / 跨天 {meta['shifted']}")

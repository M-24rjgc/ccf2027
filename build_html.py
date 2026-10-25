# -*- coding: utf-8 -*-
"""生成自包含 HTML 倒计时看板"""
import json, os, datetime
from collections import Counter

D = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(os.path.join(D, "merged.json"), encoding="utf-8"))

def s(d, k, default=""):
    v = d.get(k)
    return v if isinstance(v, str) else (default if v is None else v)

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
        "pages": s(r, "pages"), "blind": s(r, "blind"), "sys": s(r, "system"),
    })

n = len(data)
n_ok = sum(1 for d in data if d["vs"] == "已核实")
n_nb = sum(1 for d in data if d["nbs"] == "有专属条款")
n_gap = sum(1 for d in data if d["gap"])
ccfc = Counter(d["ccf"] for d in data)
ccf_line = " · ".join(f"{k} {ccfc[k]}" for k in ("A", "B", "C", "N") if ccfc[k])
n_shift = sum(1 for r in rows if r["raw_dl"] and r["full_dl"] and r["raw_dl"][:10] != r["full_dl"][:10])
tzc = Counter(r["tz"] for r in rows)
n_m12 = tzc.get("AoE", 0) + tzc.get("UTC-12", 0)
dirs = sorted({d["dir"] for d in data})
DIRS_CN = ["人工智能", "体系结构/并行/存储", "计算机网络", "网络与信息安全", "软件工程/系统软件",
           "数据库/数据挖掘", "计算机科学理论", "图形学与多媒体", "人机交互与普适计算", "交叉/综合/新兴"]
dirs = [x for x in DIRS_CN if x in dirs] + [x for x in dirs if x not in DIRS_CN]

payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
now = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M") + "（北京）"

HTML = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CCF 2027 会议 · 投稿倒计时看板</title>
<style>
:root{{
  --bg:#F4F6F9; --surface:#FFFFFF; --ink:#1B2430; --ink2:#41505F; --muted:#78838F;
  --line:#E4E8EE; --line2:#EEF1F5; --navy:#1F3552; --accent:#2D6A9F;
  --red:#C0392B; --redbg:#FBEAE7; --amber:#A9701A; --amberbg:#FCF3E2;
  --green:#1E7B45; --greenbg:#E6F2EA; --gray:#8B949E; --graybg:#F0F2F5;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:1720px;margin:0 auto;padding:28px 28px 64px}}

/* ---- header ---- */
.hd{{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:22px;flex-wrap:wrap}}
.hd h1{{font-size:23px;font-weight:650;letter-spacing:-.3px;color:var(--navy)}}
.hd .sub{{color:var(--muted);font-size:12px;margin-top:5px}}
.hd .sub b{{color:var(--ink2);font-weight:600}}
.legend{{display:flex;gap:14px;font-size:11.5px;color:var(--muted);flex-wrap:wrap}}
.legend i{{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}}

/* ---- stats ---- */
.stats{{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:18px}}
.stat{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;position:relative;overflow:hidden}}
.stat::before{{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--line)}}
.stat.a::before{{background:var(--navy)}} .stat.b::before{{background:var(--green)}}
.stat.c::before{{background:var(--red)}} .stat.d::before{{background:var(--amber)}}
.stat.e::before{{background:var(--accent)}} .stat.f::before{{background:#7A5C9E}}
.stat .k{{font-size:11.5px;color:var(--muted);letter-spacing:.3px}}
.stat .v{{font-size:27px;font-weight:640;letter-spacing:-1px;margin-top:2px;font-variant-numeric:tabular-nums}}
.stat .n{{font-size:11px;color:var(--muted);margin-top:1px}}

/* ---- toolbar ---- */
.bar{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:13px 16px;margin-bottom:14px;
  display:flex;gap:14px 20px;align-items:center;flex-wrap:wrap}}
.grp{{display:flex;align-items:center;gap:7px}}
.grp > div{{display:flex;flex-wrap:wrap;gap:6px}}
.grp.dirs{{flex:1 0 100%;align-items:flex-start}}
.grp.dirs > span{{margin-top:5px}}
.grp > span{{font-size:11px;color:var(--muted);letter-spacing:.4px;white-space:nowrap}}
.chip{{border:1px solid var(--line);background:#fff;border-radius:14px;padding:3.5px 11px;font-size:12px;
  color:var(--ink2);cursor:pointer;transition:.13s;white-space:nowrap;user-select:none}}
.chip:hover{{border-color:#C3CEDA;background:#FAFBFD}}
.chip.on{{background:var(--navy);border-color:var(--navy);color:#fff;font-weight:500}}
.chip.k-a.on{{background:var(--red);border-color:var(--red)}}
.chip.k-b.on{{background:var(--amber);border-color:var(--amber)}}
.chip.k-c.on{{background:var(--accent);border-color:var(--accent)}}
input#q{{border:1px solid var(--line);border-radius:8px;padding:6.5px 12px;font-size:12.5px;width:240px;
  outline:none;font-family:inherit;color:var(--ink)}}
input#q:focus{{border-color:var(--accent);box-shadow:0 0 0 3px rgba(45,106,159,.1)}}
.clr{{margin-left:auto;font-size:12px;color:var(--muted);cursor:pointer;text-decoration:underline;
  text-underline-offset:2px}}
.clr:hover{{color:var(--accent)}}

/* ---- table ---- */
.card{{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}}
.scroll{{overflow:auto;max-height:calc(100vh - 210px)}}
table{{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}}
thead th{{position:sticky;top:0;z-index:3;background:var(--navy);color:#fff;font-weight:560;font-size:11.5px;
  text-align:left;padding:10px 10px;letter-spacing:.3px;white-space:nowrap;cursor:pointer;user-select:none;
  border-bottom:1px solid var(--navy)}}
thead th:hover{{background:#28425F}}
thead th .ar{{opacity:.45;font-size:9px;margin-left:3px}}
tbody td{{padding:9px 10px;border-bottom:1px solid var(--line2);vertical-align:middle}}
tbody tr:hover td{{background:#F7FAFD}}
tbody tr.closed td{{color:#9AA4AF}}
tbody tr.closed td.name b{{color:#9AA4AF}}
td.name b{{font-weight:620;color:var(--ink);font-size:13px}}
td.name .fn{{display:block;color:var(--muted);font-size:10.5px;line-height:1.35;margin-top:1px;
  max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
td.tp{{max-width:250px;color:var(--ink2);font-size:11.5px;line-height:1.45}}
td.nbcell{{max-width:270px;font-size:11.5px;line-height:1.4;color:var(--ink2)}}
.nbdot{{display:inline-block;width:5px;height:5px;border-radius:50%;background:#7A5C9E;
  margin-right:5px;vertical-align:2px}}
.mono{{font-family:"SF Mono",Consolas,"Roboto Mono",monospace;font-size:11.5px;
  font-variant-numeric:tabular-nums;letter-spacing:-.2px;white-space:nowrap}}
.rl{{display:block;max-width:125px;overflow:hidden;text-overflow:ellipsis;font-family:inherit;
  font-size:10px;color:var(--muted);letter-spacing:0;margin-top:1px}}
.tag{{display:inline-block;padding:1.5px 7px;border-radius:5px;font-size:10.5px;font-weight:600;letter-spacing:.2px}}
.t-A{{background:var(--redbg);color:#9C1F1F}} .t-B{{background:var(--amberbg);color:#8A5A10}}
.t-C{{background:#E7F0FA;color:#1D4E7E}} .t-N{{background:var(--graybg);color:#6B7480}}
.days{{font-weight:660;font-variant-numeric:tabular-nums}}
.d-urgent{{color:var(--red)}} .d-warn{{color:var(--amber)}} .d-ok{{color:var(--green)}} .d-off{{color:var(--gray);font-weight:400}}
.st{{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:1px}}
.s-open{{background:var(--green)}} .s-closed{{background:#C4CBD4}} .s-tbd{{background:var(--amber)}}
.vs{{font-size:11px;padding:1.5px 7px;border-radius:5px;white-space:nowrap}}
.vs-ok{{background:var(--greenbg);color:var(--green);font-weight:600}}
.vs-np{{background:var(--amberbg);color:var(--amber)}}
.vs-un{{background:var(--graybg);color:var(--gray)}}
.muted{{color:var(--muted)}}
.empty{{padding:56px;text-align:center;color:var(--muted);font-size:13px}}
.foot{{margin-top:16px;font-size:11.5px;color:var(--muted);line-height:1.85}}
.foot b{{color:var(--ink2);font-weight:600}}
a{{color:var(--accent);text-decoration:none}} a:hover{{text-decoration:underline}}
button,input,select{{font:inherit}}
:focus-visible{{outline:3px solid var(--accent);outline-offset:3px}}
.site-nav{{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 28px;background:var(--surface);border-bottom:1px solid var(--line)}}
.site-nav strong{{font-size:17px;color:var(--ink)}}
.site-nav nav{{display:flex;gap:8px;align-items:center}}
.site-nav nav a,.site-nav nav span{{padding:7px 10px;border-radius:8px}}
.site-nav [aria-current]{{background:var(--graybg);font-weight:600}}
.back-home{{font-weight:600}}
.grp{{flex-wrap:wrap}}
.dirs summary{{cursor:pointer;color:var(--ink2);font-weight:600}}
.dirs #dirs{{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}}
.bar .dirs{{width:100%}}
.chip{{background:var(--surface);min-height:32px}}
.clr{{border:0;background:none;padding:8px}}
.results-bar{{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:10px 2px;color:var(--ink2)}}
.results-bar label{{margin-left:auto;cursor:pointer}}
.results-bar .muted{{font-size:12px}}
.scroll{{max-height:70vh}}
table{{min-width:880px}}
table:not(.expanded) :is(th,td):nth-child(6),table:not(.expanded) :is(th,td):nth-child(7),table:not(.expanded) :is(th,td):nth-child(8),table:not(.expanded) :is(th,td):nth-child(9),table:not(.expanded) :is(th,td):nth-child(11){{display:none}}
td.name{{position:sticky;left:0;z-index:1;background:var(--surface);min-width:160px;max-width:200px;border-right:1px solid var(--line)}}
td.name .fn{{max-width:180px}}
thead th:first-child{{left:0;z-index:4}}
thead button{{border:0;background:none;color:inherit;cursor:pointer;white-space:nowrap}}
.empty button{{display:block;margin:12px auto;border:1px solid var(--line);padding:8px 12px;border-radius:8px;background:var(--surface);color:var(--accent);cursor:pointer}}
td.name a b{{color:var(--accent)}}
@media(max-width:1100px){{.stats{{grid-template-columns:repeat(3,1fr)}}.wrap{{padding:18px 14px 40px}}}}
@media(max-width:600px){{
 .site-nav{{padding:10px 12px;flex-wrap:wrap;gap:6px}}.site-nav nav{{width:100%;justify-content:space-between}}
 .wrap{{padding:16px 12px 32px}}.hd{{margin-bottom:14px;gap:10px}}.hd h1{{font-size:20px}}
 .stats{{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}}.stat{{padding:8px}}.stat .k{{font-size:11px;min-height:32px}}.stat .v{{font-size:23px}}.stat .n,.stat:nth-child(n+5){{display:none}}
 .bar{{padding:12px;gap:10px}}input#q{{width:100%;font-size:16px;order:-1}}.grp{{gap:6px}}.chip{{padding:5px 9px}}
 table:not(.expanded){{min-width:520px}}table:not(.expanded) :is(th,td):nth-child(2),table:not(.expanded) :is(th,td):nth-child(10),table:not(.expanded) :is(th,td):nth-child(12),table:not(.expanded) :is(th,td):nth-child(13){{display:none}}
 td.name{{min-width:110px;max-width:130px}}td.name .fn{{max-width:110px;font-size:10px}}.results-bar .muted{{flex-basis:100%}}
}}
@media(prefers-color-scheme:dark){{
 :root{{--bg:#0F141A;--surface:#161C24;--ink:#E6EBF1;--ink2:#B6C1CD;--muted:#8592A0;--line:#273140;--line2:#212A36;--navy:#3A5A85;--accent:#6FA8DC;--graybg:#212A36;--green:#6CC891;--greenbg:#1A2E22;--amber:#E2AD5A;--amberbg:#33281A;--red:#F08A80;--redbg:#3A1E1C;color-scheme:dark}}
 .hd h1{{color:var(--ink)}}.chip:hover,tbody tr:hover td{{background:#1B232D}}input#q{{background:var(--surface)}}
 .t-A{{color:var(--red)}}.t-B{{color:var(--amber)}}.t-C{{background:#1C2A3A;color:var(--accent)}}
}}
</style>
</head>
<body>
<header class="site-nav">
  <a class="home-link" href="index.html#chat"><strong>CCF 会议助手</strong></a>
  <nav aria-label="主导航"><a class="home-link back-home" href="index.html#chat">← 返回问答</a><a class="home-link" href="index.html#library">查会议</a><span aria-current="page">倒计时看板</span></nav>
</header>
<div class="wrap">

  <div class="hd">
    <div>
      <h1>2027 投稿倒计时</h1>
      <div class="sub">{n} 个会议 · 截稿均为<b>北京时间</b> · 当前 <span id="nowtxt"></span><br>点击会议名查看投稿规则与来源。</div>
    </div>
    <div class="legend">
      <span><i style="background:var(--red)"></i>≤30 天</span>
      <span><i style="background:var(--amber)"></i>31–90 天</span>
      <span><i style="background:var(--green)"></i>90 天以上</span>
      <span><i style="background:#C4CBD4"></i>已截止</span>
    </div>
  </div>

  <div class="stats">
    <div class="stat a"><div class="k">会议总数</div><div class="v">{n}</div><div class="n">CCF-{ccf_line}</div></div>
    <div class="stat b"><div class="k">还可以投</div><div class="v" id="s-open">–</div><div class="n">有未过期轮次</div></div>
    <div class="stat c"><div class="k">30 天内截止</div><div class="v" id="s-soon">–</div><div class="n">按北京时间计</div></div>
    <div class="stat d"><div class="k">已截止</div><div class="v" id="s-closed">–</div><div class="n">可看下一年或次轮</div></div>
    <div class="stat e"><div class="k">官网已核实</div><div class="v">{n_ok}</div><div class="n">参会与投稿规则来自官方</div></div>
    <div class="stat f"><div class="k">有新人作者条款</div><div class="v">{n_nb}</div><div class="n">首投 / 学生作者另有规定</div></div>
  </div>

  <div class="bar">
    <details class="dirs"><summary>按研究方向筛选</summary><div id="dirs"></div></details>
    <div class="grp"><span>评级</span><div id="ccfs"></div></div>
    <div class="grp"><span>状态</span>
      <button type="button" class="chip on" data-st="all">全部</button>
      <button type="button" class="chip" data-st="未截止">可投</button>
      <button type="button" class="chip" data-st="30">30 天内</button>
      <button type="button" class="chip" data-st="nb">有新人条款</button>
      <button type="button" class="chip" data-st="gap">信息待补 {n_gap}</button>
      <button type="button" class="chip" data-st="已截止">已截止</button>
    </div>
    <input id="q" type="search" aria-label="搜索看板会议" placeholder="搜会议名 / 主题 / 地点…">
    <button type="button" class="clr" id="clr">重置筛选</button>
  </div>
  <div class="results-bar"><b id="result-count" role="status"></b><label><input type="checkbox" id="all-columns"> 显示全部列</label><span class="muted">横向滚动查看其余列 · 点击表头排序</span></div>
  <div class="card">
    <div class="scroll">
      <table>
        <thead><tr id="th"></tr></thead>
        <tbody id="tb"></tbody>
      </table>
      <div class="empty" id="empty" style="display:none">没有符合条件的会议，试试减少筛选条件。<button type="button" id="empty-reset">重置筛选</button></div>
    </div>
  </div>

  <div class="foot">
    <b>怎么读这张表</b>　「正文截稿」是按北京时间算的，{n_m12} 个会议的原始时区是 AoE / UTC−12，折算后要 +20 小时，<b>{n_shift} 个会议的截稿日因此顺延了一天</b>，别拿 ccfddl 上的日期直接对照。多轮会议过了一轮会自动切到下一轮。<br>
    「官网核查」为<b>已核实</b>的行，参会形式与投稿上限来自官方页面原文；<b>2027 CFP 未发布</b>表示官网还没有 2027 征稿说明，字段一律留「待确认」，没有用往届口径冒充。<br>
    「投稿上限」只填官方明文写出的数字，没写就是「不限」，已统一成「N 篇/届、/轮、/年」，点表头可按篇数排序。ACL / NAACL / EACL / COLING 走 ARR 滚动审稿，主表里的日期是 commit 节点，真实投稿看 ARR cycle。<br>
    「<b>新人作者条款</b>」专指首投者会踩的坑：审稿义务/互惠审稿、首投配额、是否强制挂资深作者、投稿账号门槛、学生新人通道。点顶部<b>「有新人条款」</b>可只看这些会；<b>「无专属条款」是查过确实没有，不是没查</b>。
  </div>
</div>

<script>
const DATA = {payload};
const DIRS = {json.dumps(dirs, ensure_ascii=False)};
const COLS = [
  ["abbr","会议",150],["dir","方向",150],["ccf","CCF",54],["dl","正文截稿 (北京)",124],
  ["days","剩余",68],["dec","录用通知",104],["date","会期",140],["place","地点",150],
  ["fmt","形式",62],["onsite","必须到场",82],["aln","投稿上限",74],
  ["nb","新人作者条款",200],["vs","核查",96]
];
let sel = {{dir:new Set(), ccf:new Set(), st:"all", q:""}};
let sortKey = "days", sortDir = 1;
const APP_HOME = location.pathname.endsWith("/dashboard.html") ? "index.html" : "site/index.html";
document.querySelectorAll("a.home-link").forEach(a=>{{a.href=APP_HOME+(a.hash||"");}});
let expanded = false;
try {{
  const saved=JSON.parse(sessionStorage.getItem("ccf.dashboard.v1")||"null");
  if(saved){{
    sel={{dir:new Set((saved.dir||[]).filter(x=>DIRS.includes(x))),ccf:new Set((saved.ccf||[]).filter(x=>["A","B","C","N"].includes(x))),st:["all","未截止","30","nb","gap","已截止"].includes(saved.st)?saved.st:"all",q:typeof saved.q==="string"?saved.q:""}};
    if(COLS.some(c=>c[0]===saved.sortKey))sortKey=saved.sortKey;
    sortDir=saved.sortDir===-1?-1:1; expanded=!!saved.expanded;
  }}
}} catch {{}}
function saveFilters(){{try{{sessionStorage.setItem("ccf.dashboard.v1",JSON.stringify({{dir:[...sel.dir],ccf:[...sel.ccf],st:sel.st,q:sel.q,sortKey,sortDir,expanded}}));}}catch{{}}}}

const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}})[c]);
const bjTime = s => s ? Date.parse(s.replace(" ","T")+":00+08:00") : NaN;

// 按当前时刻为每个会议选轮次：最早的未过期轮次；全过期取最后一轮；无日期为 TBD
function recompute(){{
  const now = Date.now();
  DATA.forEach(d=>{{
    const rs = d.rounds.filter(x=>x.dl).map(x=>({{...x, t:bjTime(x.dl)}}));
    const up = rs.filter(x=>x.t>now).sort((a,b)=>a.t-b.t);
    let m = null;
    if(up.length){{ m = up[0]; d.status = "未截止"; }}
    else if(rs.length){{ m = rs.reduce((a,b)=>a.t>b.t?a:b); d.status = "已截止"; }}
    else d.status = "TBD";
    d.dl = m ? m.dl : ""; d.round = m ? m.l : "";
    d.dec = (d.rounds.length<=1 && d.decv) || (m && m.dec) || "";
    d.days = d.status==="未截止" ? Math.floor((m.t-now)/864e5) : null;
  }});
  const open = DATA.filter(d=>d.status==="未截止");
  document.getElementById("s-open").textContent = open.length;
  document.getElementById("s-soon").textContent = open.filter(d=>d.days<=30).length;
  document.getElementById("s-closed").textContent = DATA.filter(d=>d.status==="已截止").length;
  document.getElementById("nowtxt").textContent = new Date(now+8*3600e3).toISOString().slice(0,16).replace("T"," ")+" 北京";
}}

function initChips(){{
  const dEl = document.getElementById("dirs");
  DIRS.forEach(d=>{{
    const b=document.createElement("button"); b.type="button";
    b.className="chip"; b.textContent=d; b.dataset.dir=d;
    b.onclick=()=>{{ b.classList.toggle("on");
      sel.dir.has(d)?sel.dir.delete(d):sel.dir.add(d); render(); }};
    dEl.appendChild(b);
  }});
  const cEl = document.getElementById("ccfs");
  [["A","A"],["B","B"],["C","C"],["N","N"]].forEach(([v,l])=>{{
    const b=document.createElement("button"); b.type="button";
    b.className="chip k-"+v.toLowerCase(); b.textContent=l; b.dataset.ccf=v;
    b.onclick=()=>{{ b.classList.toggle("on");
      sel.ccf.has(v)?sel.ccf.delete(v):sel.ccf.add(v); render(); }};
    cEl.appendChild(b);
  }});
  document.querySelectorAll("[data-st]").forEach(b=>{{
    b.onclick=()=>{{ document.querySelectorAll("[data-st]").forEach(x=>x.classList.remove("on"));
      b.classList.add("on"); sel.st=b.dataset.st; render(); }};
  }});
  document.getElementById("q").oninput=e=>{{ sel.q=e.target.value.trim().toLowerCase(); render(); }};
  document.getElementById("q").value=sel.q;
  document.querySelector("details.dirs").open=sel.dir.size>0;
  document.getElementById("all-columns").checked=expanded;
  document.querySelector("table").classList.toggle("expanded",expanded);
  document.getElementById("all-columns").onchange=e=>{{expanded=e.target.checked;document.querySelector("table").classList.toggle("expanded",expanded);saveFilters();}};
  document.getElementById("empty-reset").onclick=()=>document.getElementById("clr").click();
  document.getElementById("clr").onclick=()=>{{
    sel={{dir:new Set(),ccf:new Set(),st:"all",q:""}};
    document.querySelectorAll(".chip").forEach(c=>c.classList.remove("on"));
    document.querySelector('[data-st="all"]').classList.add("on");
    document.getElementById("q").value=""; render();
  }};
}}

function head(){{
  document.getElementById("th").innerHTML = COLS.map(([k,l])=>
    `<th data-k="${{k}}" aria-sort="${{sortKey===k?(sortDir>0?'ascending':'descending'):'none'}}"><button type="button">${{l}}<span class="ar">${{sortKey===k?(sortDir>0?"▲":"▼"):"↕"}}</span></button></th>`
  ).join("");
  document.querySelectorAll("th[data-k]").forEach(th=>{{
    th.onclick=()=>{{ const k=th.dataset.k;
      sortDir = (sortKey===k)? -sortDir : 1; sortKey=k; head(); render(); }};
  }});
}}

function daysCell(d){{
  if(d.status!=="未截止"||d.days===null) return `<span class="days d-off">—</span>`;
  const c = d.days<=30?"d-urgent":d.days<=90?"d-warn":"d-ok";
  return `<span class="days ${{c}}">${{d.days===0?'不足 1':d.days}}<span style="font-size:10px;font-weight:400"> 天</span></span>`;
}}

function cardCell(v){{
  if(!v||v==="待确认") return `<span class="muted">待确认</span>`;
  return v;
}}

function render(){{
  document.querySelectorAll(".chip").forEach(b=>{{const on=b.dataset.dir?sel.dir.has(b.dataset.dir):b.dataset.ccf?sel.ccf.has(b.dataset.ccf):b.dataset.st===sel.st;b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on));}});
  saveFilters();
  let rs = DATA.filter(d=>{{
    if(sel.dir.size && !sel.dir.has(d.dir)) return false;
    if(sel.ccf.size && !sel.ccf.has(d.ccf)) return false;
    if(sel.st==="30"){{ if(!(d.status==="未截止"&&d.days!==null&&d.days<=30)) return false; }}
    else if(sel.st==="nb"){{ if(d.nbs!=="有专属条款") return false; }}
    else if(sel.st==="gap"){{ if(!d.gap) return false; }}
    else if(sel.st!=="all" && d.status!==sel.st) return false;
    if(sel.q){{
      const hay=(d.abbr+" "+d.full+" "+d.topic+" "+d.place+" "+d.dir).toLowerCase();
      if(!hay.includes(sel.q)) return false;
    }}
    return true;
  }});
  const num = v => (v===null||v===undefined)?1e9:v;
  rs.sort((a,b)=>{{
    let x=a[sortKey], y=b[sortKey];
    if(sortKey==="days"){{ x=num(x); y=num(y); }}
    else if(sortKey==="aln"){{ const lv=d=>d.aln??(d.ald==="不限"?1e8:1e9); x=lv(a); y=lv(b); }}
    else if(sortKey==="ccf"){{ const o={{A:0,B:1,C:2,N:3}}; x=o[x]??9; y=o[y]??9; }}
    else {{ x=(x||""); y=(y||""); }}
    if(x<y) return -1*sortDir; if(x>y) return 1*sortDir; return a.idx-b.idx;
  }});

  document.getElementById("tb").innerHTML = rs.map(d=>{{
    const cls = d.status==="已截止"?"closed":"";
    return `<tr class="${{cls}}">
      <td class="name"><a href="${{APP_HOME}}#${{encodeURIComponent(d.uid)}}" aria-label="查看 ${{esc(d.abbr)}} 会议资料"><b>${{esc(d.abbr)}}</b></a><span class="fn" title="${{esc(d.full)}}">${{esc(d.full)}}</span></td>
      <td><span class="muted">${{esc(d.dir)}}</span></td>
      <td><span class="tag t-${{d.ccf}}">${{d.ccf}}</span></td>
      <td class="mono" title="${{esc(d.round)}}">${{d.dl||'<span class="muted">待公布</span>'}}${{d.rounds.length>1&&d.round?`<span class="rl">${{esc(d.round)}}</span>`:''}}</td>
      <td>${{daysCell(d)}}</td>
      <td class="mono">${{d.dec||'<span class="muted">—</span>'}}</td>
      <td class="muted">${{esc(d.date)}}</td>
      <td>${{esc(d.place)}}</td>
      <td><span class="muted">${{esc(d.fmt)}}</span></td>
      <td>${{cardCell(esc(d.onsite))}}</td>
      <td>${{cardCell(esc(d.ald))}}</td>
      <td class="nbcell">${{d.nbs==='有专属条款'
          ? `<span class="nbdot"></span>${{esc(d.nb)}}`
          : `<span class="muted">${{esc(d.nb)||'—'}}</span>`}}</td>
      <td><span class="vs ${{d.vs==='已核实'?'vs-ok':(d.vs==='2027CFP未发布'?'vs-np':'vs-un')}}" title="${{esc(d.gap?'待补：'+d.gap+'（'+d.gk+'）':'')}}">${{esc(d.vs)}}</span></td>
    </tr>`;
  }}).join("");
  document.getElementById("empty").style.display = rs.length?"none":"block";
  document.getElementById("result-count").textContent=`显示 ${{rs.length}} / ${{DATA.length}} 个会议`;
}}

initChips(); head(); recompute(); render();
setInterval(()=>{{ recompute(); render(); }}, 60000);
</script>
</body>
</html>"""

OUT = os.path.join(D, "CCF2027投稿倒计时看板.html")
open(OUT, "w", encoding="utf-8").write(HTML)
print("saved:", OUT)
print("KB:", round(os.path.getsize(OUT) / 1024, 1))
print(f"统计: 总 {n}（{ccf_line}）/ 已核实 {n_ok} / 新人条款 {n_nb} / 待补 {n_gap} / 跨天 {n_shift}")

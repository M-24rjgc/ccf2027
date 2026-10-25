# -*- coding: utf-8 -*-
"""把网站「待审」区导出的修改并入数据：pending.json -> recheck/z_pending_<时间>.json + changelog.jsonl

用法：python apply_pending.py pending.json [--dry-run]
之后：python build_xlsx.py && python build_wiki.py
每条修改须带 uid、field、value、evidence_url；字段有白名单，取值有校验，不合格的整条跳过并报告。"""
import json, os, sys, datetime

D = os.path.dirname(os.path.abspath(__file__))
FIELDS = {
    "onsite": {"必须到场", "允许远程"},
    "remote": None, "author_limit": None,
    "vstatus": {"已核实"},
    "nb_status": {"有专属条款", "无专属条款"},
    "nb_review": None, "nb_quota": None, "nb_senior": {"不强制", "必须挂资深作者"},
    "nb_account": None, "nb_track": None, "nb_fee": None,
}

if len(sys.argv) < 2:
    sys.exit(__doc__)
items = json.load(open(sys.argv[1], encoding="utf-8-sig"))
if isinstance(items, dict):
    items = items.get("items", [])
uids = {r["uid"]: r for r in json.load(open(os.path.join(D, "merged.json"), encoding="utf-8"))}

now_bj = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=8)
merged, skipped = {}, []
for i, it in enumerate(items):
    uid, field, value = (str(it.get(k) or "").strip() for k in ("uid", "field", "value"))
    url = str(it.get("evidence_url") or "").strip()
    why = ("未知会议" if uid not in uids else
           "字段不在白名单" if field not in FIELDS else
           "取值不合法" if not value or (FIELDS[field] and value not in FIELDS[field]) else
           "缺出处 URL" if not url.startswith("http") else "")
    if why:
        skipped.append(f"#{i} {uid}.{field}={value!r}：{why}")
        continue
    rec = merged.setdefault(uid, {"uid": uid, "abbr": uids[uid]["abbr"], "checked": f"{now_bj:%Y-%m-%d}",
                                  "evidence": url, "notes": []})
    rec[field] = value
    rec["evidence"] = url
    quote = str(it.get("quote") or "").strip()
    rec["notes"].append(f"{field}={value}" + (f"（原文：{quote[:60]}）" if quote else ""))

out = []
for rec in merged.values():
    rec["rc_note"] = "待审合并：" + "；".join(rec.pop("notes"))
    out.append(rec)

for s in skipped:
    print("跳过", s)
if not out:
    sys.exit("没有可合并的修改")
if "--dry-run" in sys.argv:
    print(json.dumps(out, ensure_ascii=False, indent=1))
    sys.exit(0)

fp = os.path.join(D, "recheck", f"z_pending_{now_bj:%Y%m%d%H%M}.json")
os.makedirs(os.path.dirname(fp), exist_ok=True)
json.dump(out, open(fp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(os.path.join(D, "changelog.jsonl"), "a", encoding="utf-8") as f:
    for rec in out:
        f.write(json.dumps({"date": f"{now_bj:%Y-%m-%d}", "kind": "review",
                            "text": f"{rec['abbr']}：{rec['rc_note'][5:]}（{rec['evidence']}）"}, ensure_ascii=False) + "\n")
print(f"已写入 {fp}：{len(out)} 个会议，{sum(1 for _ in items) - len(skipped)} 条修改；跳过 {len(skipped)} 条")
print("下一步：python build_xlsx.py && python build_wiki.py")

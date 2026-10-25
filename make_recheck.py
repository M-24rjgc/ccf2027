# -*- coding: utf-8 -*-
"""从 merged.json 生成波次4「缺口重查」任务切片 -> recheck_slices/rXX.json
只收「官网未写明 / 官网未查到」两类；「等官方发布」的不排队，等 CFP 出来再说。
已在 recheck/ 里有记录的会议跳过（重查失败的除外，可用 --retry-failed 重新排队）。"""
import json, glob, os, sys

D = os.path.dirname(os.path.abspath(__file__))
PER_FILE = 8
rows = json.load(open(os.path.join(D, "merged.json"), encoding="utf-8"))

done, failed = set(), set()
for fp in glob.glob(os.path.join(D, "recheck", "*.json")):
    for it in json.load(open(fp, encoding="utf-8-sig")):
        uid = it.get("uid")
        if not uid:
            continue
        (failed if (it.get("rc_note") or "").startswith("重查失败") else done).add(uid)
skip = done | (set() if "--retry-failed" in sys.argv else failed)

ORD = {"A": 0, "B": 1, "C": 2, "N": 3}
q = [r for r in rows if r["gap_kind"] in ("官网未写明", "官网未查到") and r["uid"] not in skip]
q.sort(key=lambda r: ({"未截止": 0, "TBD": 1, "已截止": 2}[r["status"]],
                      r["days_left"] if r["days_left"] is not None else 9999, ORD.get(r["ccf"], 9)))

out_dir = os.path.join(D, "recheck_slices")
os.makedirs(out_dir, exist_ok=True)
for fp in glob.glob(os.path.join(out_dir, "*.json")):
    os.remove(fp)
for n, i in enumerate(range(0, len(q), PER_FILE), 1):
    chunk = [{"uid": r["uid"], "abbr": r["abbr"], "full": r["full"], "ccf": r["ccf"],
              "link": r["link"], "evidence": r["evidence"] or r["nb_evidence"],
              "gap": r["gap"], "gap_kind": r["gap_kind"],
              "status": r["status"], "days_left": r["days_left"]} for r in q[i:i + PER_FILE]]
    json.dump(chunk, open(os.path.join(out_dir, f"r{n:02d}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
print(f"排队 {len(q)} 个会议 -> {out_dir}（每份 {PER_FILE} 个）；已跳过 {len(skip)} 个已重查")

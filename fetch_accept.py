# -*- coding: utf-8 -*-
"""从 ccfddl/ccf-deadlines（MIT）拉取往届录用率 -> accept_rates.json
每条保留年份、投稿数、录用数、原始出处 URL，以及 ccfddl 的 commit，便于追溯。"""
import json, os, glob, subprocess, shutil, datetime
import yaml

D = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(D, ".cache", "ccfddl")
REPO = "https://github.com/ccfddl/ccf-deadlines.git"


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


if os.path.isdir(os.path.join(CACHE, ".git")):
    git("pull", "--depth", "1", "--ff-only", cwd=CACHE)
else:
    shutil.rmtree(CACHE, ignore_errors=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    git("clone", "--depth", "1", "--filter=blob:none", "--sparse", REPO, CACHE)
    git("sparse-checkout", "set", "accept_rates", cwd=CACHE)
commit = git("log", "-1", "--format=%H", cwd=CACHE)

rows = json.load(open(os.path.join(D, "base_2027.json"), encoding="utf-8"))
want = {(r["sub"], r["abbr_raw"]): r["uid"] for r in rows}

out, unmatched = {}, []
for fp in glob.glob(os.path.join(CACHE, "accept_rates", "*", "*.yml")):
    sub = os.path.basename(os.path.dirname(fp))
    for rec in yaml.safe_load(open(fp, encoding="utf-8")) or []:
        uid = want.get((sub, str(rec.get("title", "")).strip()))
        if not uid:
            unmatched.append(f"{sub}/{rec.get('title')}")
            continue
        items = []
        for a in rec.get("accept_rates") or []:
            if not a.get("year"):
                continue
            items.append({k: a.get(k) for k in ("year", "submitted", "accepted", "rate", "source")})
        items.sort(key=lambda a: a["year"])
        out[uid] = items

json.dump({"source": REPO, "license": "MIT (ccfddl)", "commit": commit,
           "fetched": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M"),
           "rates": out},
          open(os.path.join(D, "accept_rates.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"匹配 {len(out)}/{len(rows)} 个 2027 会议有往届录用率；ccfddl commit {commit[:8]}")
print(f"未匹配（非 2027 届或不在本表）{len(unmatched)} 个")

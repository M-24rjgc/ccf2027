# 知识库维护规则（Schema）

本目录是一个 LLM Wiki：由 LLM 维护、人审核的会议知识库。它不是 RAG——回答问题时不去翻原始材料，而是读这里已经整理好、互相链接的页面；新材料进来时，先整理进页面，再用于回答。

## 三层结构

| 层 | 位置 | 谁来改 |
|---|---|---|
| 原始资料 | `allconf.json`（ccfddl）、`accept_rates.json`、各会官网页面（evidence URL） | 不改，只读 |
| 中间数据 | `enrich/` `verify/` `newbie/` `recheck/` → `merged.json` | 各核查波次、待审合并 |
| Wiki 页面 | `wiki/**/*.md` | `build_wiki.py` 生成，**不要手改**，改上游数据后重新生成 |

本文件（`SCHEMA.md`）是唯一手写的 wiki 文件。

## 页面类型

- `conferences/<uid>.md`：一个会议一页。`uid` 取 ccfddl 的会议 id（如 `iclr27`、`iacr-fse27`），**一切合并按 uid，不按简称**。
- `directions/dir-<sub>.md`：CCF 十大方向。
- `concepts/<id>.md`：跨会议概念（AoE、ARR、互惠审稿……），成员由数据规则自动计算。
- `index.md`：总目录，回答问题时先读。`log.md`：变更日志。`LINT.md`：体检报告。

链接写作 `[[id]]` 或 `[[id|显示名]]`；链接即关系图的边。

## 出处铁律

1. 每个字段带来源标注：〔知识补全〕= 模型已有知识，未核实；〔官网核查〕〔新人条款核查〕〔缺口重查〕= 读到了官方页面。
2. 不编 URL、不编数字。没查到就写「待确认 / 未找到」，不要用默认值冒充结论。
3. 2027 CFP 未发布的会议，不用上一届条款代替。
4. 「不限」= 官方材料里没找到上限，**不等于**确认无上限。
5. 日期、时区、剩余天数一律由代码计算，不让 LLM 心算。

## 三种操作

### ingest（纳入新资料）
新资料（新一轮核查、ccfddl 更新、用户确认的修改）先写进中间数据，再 `python build_xlsx.py && python build_wiki.py` 重新生成，并在 `changelog.jsonl` 追加一行。

### query（回答问题）
1. 读 `index.md` 或用搜索定位页面；需要筛选时用筛选工具（截稿、评级、到场、新人条款由代码过滤）。
2. 读会议页、顺着 `[[链接]]` 走到方向页、概念页、同期同地的会，完成多跳推理。
3. 页面字段为待确认、CFP 未发布、或明显过时，才联网（DeepSeek Search / Fetch），优先官网。
4. 回答必须标出处：知识库页面用 `[[uid]]`，联网结果给 URL，并区分「已核实」与「推断」。
5. 联网查到与知识库不同的**官方**信息时，提交「待审修改」，不直接改库。

### lint（体检）
`build_wiki.py` 每次生成都会写 `LINT.md`：断链、孤立页、已核实却缺出处、信息缺口、CFP 未发布。CFP 集中发布期（12 月—次年 3 月）应按 `make_recheck.py` 排队重查。

## 待审修改 → 入库

网站上 AI 提出的修改进入浏览器本地的「待审」区，人确认后导出 JSON（或提交 GitHub Issue）。维护者运行：

```
python apply_pending.py pending.json   # 写入 recheck/，追加 changelog
python build_xlsx.py && python build_wiki.py
```

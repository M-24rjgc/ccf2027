# CCF 会议助手

CCF 推荐会议 2027 届的问答与选会助手。用大白话问会议，或贴一段论文摘要让它推荐投哪里。

[在线使用](https://m-24rjgc.github.io/ccf2027/)

- **知识库是 LLM Wiki，不是 RAG**：200 个会议的数据先整理成互相链接的 Markdown 页面（`wiki/`），每个字段都标了来源（知识补全 / 官网核查 / 缺口重查）。回答时读页面、沿链接多跳，不去翻原始材料。
- **日期由代码算**：截稿时间统一为北京时间，剩余天数、当前轮次按访问时刻实时计算，不让模型心算。
- **知识库缺信息才联网**：用 DeepSeek Search / Fetch 查官网；查到的新信息进「待审」区，人审过才入库。
- **关系图**：会议 · 方向 · 概念 · 同期同地，可点可看；回答后高亮推理路径。

纯静态网站，部署在 GitHub Pages。API Key 由每位使用者在浏览器「设置」里填写，只存在本机 localStorage，不进仓库。

## 目录

```
allconf.json            ccfddl 原始数据
extract.py              → base_2027.json（2027 届 200 个会议，时间折北京时间）
enrich/ verify/ newbie/ recheck/   各核查波次的结果（recheck/ 也接收待审合并）
build_xlsx.py           → merged.json + CCF2027会议投稿规划表.xlsx
build_html.py           → CCF2027投稿倒计时看板.html
fetch_accept.py         → accept_rates.json（ccfddl 往届录用率，MIT）
concepts.json           概念页内容（AoE、ARR、互惠审稿…）
build_wiki.py           → wiki/（LLM Wiki）+ site/data/wiki.json
apply_pending.py        待审修改 → recheck/ + changelog.jsonl
make_recheck.py         信息缺口 → recheck_slices/（本地核查队列）
wiki/SCHEMA.md          知识库维护规则（唯一手写的 wiki 文件）
site/                   网站（GitHub Pages 根目录）
```

## 更新数据

```bash
python extract.py          # ccfddl 数据有更新时
python fetch_accept.py     # 刷新往届录用率（需要 git）
python build_xlsx.py
python build_html.py
python build_wiki.py       # 生成 wiki/ 与 site/data/wiki.json，并输出体检报告 wiki/LINT.md
```

依赖：Python 3.10+，`pip install openpyxl pyyaml`。

## 待审修改入库

网站「待审」页 → 采纳 → 导出 `pending.json`（或「提交 GitHub Issue」后把 JSON 存成文件），然后：

```bash
python apply_pending.py pending.json --dry-run   # 先预览
python apply_pending.py pending.json
python build_xlsx.py && python build_wiki.py
```

字段有白名单、取值有校验、必须带出处 URL，不合格的会被跳过并报告。

## 本地预览

```bash
python -m http.server 8765 --directory site
```

用 **http://localhost:8765** 打开（不要用 127.0.0.1：StepFun 接口对这个来源返回的跨域头有问题，浏览器会报 Failed to fetch）。

## 部署到 GitHub Pages

1. 建仓库并推送（`.env` 已在 `.gitignore` 里）。
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
3. 推送到 `main` 后 `.github/workflows/pages.yml` 自动发布 `site/`。

## 模型与接口

| 用途 | 接口 | 说明 |
|---|---|---|
| 推理 | OpenAI 兼容 Chat Completions，默认 StepFun `step-5-preview` | `reasoning_effort` 按问题自动路由：单会议事实查询 low，一般问题 medium，推荐/对比/贴摘要 high；也可手动指定 |
| 联网 | DeepSeek `POST /v1/tools/search`、`/v1/tools/fetch` | 按成功请求计费；未填 Key 时只用知识库回答 |

两个接口都允许浏览器跨域直连，所以不需要后端。

## 数据来源与许可

- 会议截稿、往届录用率：[ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines)（[MIT 许可](site/CCFDDL-LICENSE.txt)）
- 参会要求、投稿上限、新人条款：各会议官网，出处 URL 见每个会议页
- ARR 日期：[aclrollingreview.org/dates](https://aclrollingreview.org/dates)

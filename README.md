# 现场台词变化下的双语舞台字幕工作台

给学校剧场的普通话/英文现场字幕使用。舞台声音由字幕员人工听辨、手动录入，
**不接语音识别**。系统负责：位置识别与歧义闸门、双语语义防泄露、设备行宽/行数/停留
限制、跳段/走向/返场处置、稿本安全切换，以及可复查、可分支重练的排练记录。

## 数据模型（UTF-8 JSON）

- `script`：台词节点。`next` 是允许的后继句（空数组表示末尾）；`variants` 为登记的
  实际说法；`shortForms` 为**已人工批准**的短句；`scene`/`speaker` 用于区分同句不同场次、人物。
- `sections`：可跳过段落。`lines` 为段落内台词，`exits` 为进入该段的边，跳段时封死这些边。
- `draft`：译稿。`source` 是覆盖的原句；`segments[].requires` 声明每段译文依赖哪些原句
  实际被说过——后句的身份、否定、笑点在依赖满足前不会提前出现。`meaningId` 标识语义，
  稿本切换时用它判断译文是否“原意已变”。`approvedShortForms` 是已批准英文短句。
- `devices`：本地侧幕配置，`columns`/`lines` 按 Unicode 码点计，`minHoldMs` 为最短停留。
- `cues`：相对场次开始的毫秒提示。`kind` 为 `heard`（听辨台词）或 `director`（舞监提示）。

舞监指令支持结构化写法：`skip sec-x`、`take s3`、`encore s1`、`resolve s1`、`goto s1`、
`blank`，以及明确的中文词汇（清屏/跳过/返场等）。**无法明确解析的自由文本不会被猜测执行，
只记录为待人工处理。**

## 核心安全语义

1. **位置识别不靠模糊相似**：只接受原文、登记变体或已批准短句；无法定位则记录并等待人工。
2. **同句区分场次/人物/返场**：匹配在“待匹配前沿 + 场次 + 说话人 + 出现次数”上进行；
   故意返场以 occurrence 序号区分历次用法。
3. **歧义闸门**：多个位置都说得通时，字幕员看到全部候选；只有每个候选位置下**都允许且
   意思相同**的内容才继续显示，无交集则保持旧画面/空屏，直到人工 `resolve`。
4. **跳段/走向不泄露**：跳段封边并把段落台词移出活动集合，两种语言中被跳过内容的排队帧
   作废、在屏帧到最短停留后撤除；已实际播过的画面永久保留在排练记录。
5. **设备限制硬约束**：超行宽内容标记 overflow 并拦截，不分页硬塞；每条分页帧至少停留
   `minHoldMs`，快速切换只排队不抢屏；空屏同样受停留约束（逐设备到点执行）。
6. **未审短句不播**：未登记的说法无法确认位置，未批准的英文短句被 `shortform-blocked` 拦截。
7. **稿本安全切换**：新版本若找不回当前台词、已批准译文缺失或 `meaningId` 漂移，则拒绝
   切换并保留当前安全稿本，提示人工决定；同 meaningId 的译文润色视为安全。
8. **完整已批准稿本可独立运行**：现场显示只依赖已加载的批准稿本，编辑未来句子不影响在播。

## 运行（Node.js 22.23.4，标准库零依赖）

```sh
npm test                 # 36 项 node:test，覆盖全部安全不变量
npm run inspect:data     # 原始资料计数与引用检查
npm run run:show         # 按 data/sample-show.json 的 cues 完整跑一遍并落盘
npm run run:legacy       # 兼容早期扁平 inputs.json
npm run serve            # 启动本地 Web 工作台（默认 http://localhost:4173）
```

CLI：

```sh
node cli/run-show.mjs <show.json> [输出目录]
node cli/review.mjs <data/runs/某场记录.json>
node cli/replay-branch.mjs <记录.json> <show.json> <事件seq> [输出目录]
```

## 本地 Web 工作台

- 控制台 `http://localhost:4173/`：录入听辨台词/舞监提示、人工裁决歧义、请求空屏、
  粘贴新稿 JSON 做安全切换、查看前沿/已确认/事件流水/投屏预览。
- 投屏页（可在另一块屏幕/窗口打开）：
  - 中文 `http://localhost:4173/screen.html?device=side-zh`
  - 英文 `http://localhost:4173/screen.html?device=side-en`
- 状态经 SSE 实时推送；投屏页定时推进停留计时，到点自动换页/清屏。

## 代码结构

| 路径 | 职责 |
| --- | --- |
| `src/text.mjs` | 文本规范化、码点计数、已批准说法匹配 |
| `src/script.mjs` | 剧本图校验、入口/后继、候选匹配、可达性 |
| `src/translate.mjs` | 译稿归一化、分段语义闸门、修订语义对比 |
| `src/layout.mjs` | 行宽折行、分页、超宽拦截 |
| `src/director.mjs` | 舞监提示解析（不猜测含糊文本） |
| `src/engine.mjs` | 位置识别、歧义闸门、跳段/走向/返场、增量发布、稿本切换 |
| `src/scheduler.mjs` | 虚拟时钟分页调度、最短停留、空屏、失效帧撤除 |
| `src/rehearsal.mjs` | 时间线执行、记录落盘、复查报告、分支重练 |
| `src/document.mjs` | 文档加载/校验，兼容旧版 inputs.json |
| `src/web/` | 零依赖 HTTP + SSE 工作台与投屏页面 |
| `cli/` | run-show / review / replay-branch / serve |
| `test/` | 36 项自动化测试 |

记录、人员、地点和业务编号均为合成内容。

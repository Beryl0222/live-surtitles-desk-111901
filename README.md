# 现场台词变化下的双语舞台字幕编排

script 的 next 是剧本允许的后继句，空数组表示已到末尾。draft 的 source 表示译稿约定的原句覆盖，不代表可提前播出。devices 给出本地侧幕配置，cues 的 at 是相对场次开始的毫秒数。

资料保存在 `data/inputs.json`，采用 UTF-8 JSON。记录、人员、地点和业务编号均为合成内容。

运行环境为 Node.js 22.23.4，资料工具和测试使用 Node.js 标准库。

```sh
npm run inspect:data
npm test
```

`inspect:data` 读取资料并列出记录数。测试核对该批资料的字段和引用完整性。

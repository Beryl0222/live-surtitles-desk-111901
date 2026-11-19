#!/usr/bin/env node
// 用法: node cli/run-show.mjs <show.json> [输出目录]
// 按 cues 时间线完整跑一遍排练并落盘记录。
import { loadDocument } from '../src/document.mjs';
import { Runner } from '../src/rehearsal.mjs';

const [showFile, outDir = 'data/runs'] = process.argv.slice(2);
if (!showFile) {
  console.error('用法: node cli/run-show.mjs <show.json> [输出目录]');
  process.exit(1);
}
const doc = await loadDocument(showFile);
const runner = new Runner(doc, { runId: `run-${new Date().toISOString().replace(/[:.]/g, '-')}` });
const record = runner.runAll(doc.cues);
const file = await runner.save(outDir);
console.log(`排练完成: ${file}`);
console.log(`确认台词 ${record.finalState.spoken.length} 处，引擎事件 ${record.engineLog.length} 条`);
for (const [deviceId, dump] of Object.entries(record.scheduler)) {
  console.log(`  ${deviceId}: 播出 ${dump.history.length} 帧，拦截/丢弃 ${dump.dropped.length} 帧`);
}

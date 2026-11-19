#!/usr/bin/env node
// 用法: node cli/replay-branch.mjs <run-record.json> <show.json> <事件seq> [输出目录]
// 从任意一次排练的指定事件开出练习分支，重放后续 cues，仍遵守提示时间与停留限制。
import { loadDocument } from '../src/document.mjs';
import { loadRun, replayFromRecord } from '../src/rehearsal.mjs';

const [recordFile, showFile, seqText, outDir = 'data/runs'] = process.argv.slice(2);
if (!recordFile || !showFile || seqText === undefined) {
  console.error('用法: node cli/replay-branch.mjs <run-record.json> <show.json> <事件seq> [输出目录]');
  process.exit(1);
}
const record = await loadRun(recordFile);
const doc = await loadDocument(showFile);
const atSeq = Number(seqText);
const branchAt = record.cues.find((_, i) => i >= 0)?.at ?? 0;
const forkAt = record.engineLog.filter((e) => e.seq <= atSeq).at(-1)?.at ?? branchAt;
const runner = replayFromRecord(record, doc, atSeq,
  `branch-${record.runId}-at${atSeq}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
// 重放分支点之后的 cues
const laterCues = record.cues.filter((c) => c.at > forkAt);
for (const cue of laterCues) runner.step(cue);
const file = await runner.save(outDir);
console.log(`分支练习完成: ${file}`);
console.log(`分支点事件 seq=${atSeq}，重放 ${laterCues.length} 条后续提示`);

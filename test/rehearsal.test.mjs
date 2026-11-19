import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument } from '../src/document.mjs';
import { Runner, reviewReport, replayFromRecord } from '../src/rehearsal.mjs';
import { parseDirector } from '../src/director.mjs';

const doc = await loadDocument(new URL('../data/sample-show.json', import.meta.url));

test('完整时间线可复跑：停留限制与提示时间确定', () => {
  const r1 = new Runner(doc, { runId: 'r-a' }).runAll(doc.cues);
  const r2 = new Runner(doc, { runId: 'r-b' }).runAll(doc.cues);
  assert.deepEqual(
    r1.scheduler['side-zh'].history.map((h) => [h.frameId, h.shownAt]),
    r2.scheduler['side-zh'].history.map((h) => [h.frameId, h.shownAt]),
  );
});

test('记录包含每块屏幕何时显示了什么以及未播原因', () => {
  const record = new Runner(doc, { runId: 'r' }).runAll(doc.cues);
  const report = reviewReport(record);
  assert.match(report, /屏幕 side-zh/);
  assert.match(report, /屏幕 side-en/);
  assert.match(report, /上屏/);
  // 未审短句“我完全没印象”被记录为无法定位
  assert.ok(record.engineLog.some((e) => e.type === 'heard-unmatched'));
});

test('跳段与返场事件进入记录，且被跳过译文从未上屏', () => {
  const record = new Runner(doc, { runId: 'r' }).runAll(doc.cues);
  assert.ok(record.engineLog.some((e) => e.type === 'section-skipped'));
  assert.ok(record.engineLog.some((e) => e.type === 'encore'));
  const shownEn = record.scheduler['side-en'].history.map((h) => h.text).join('\n');
  assert.ok(!shownEn.includes('I did not take it.'), '跳过段译文不得出现在任何已播画面');
});

test('可从任意事件 seq 开出练习分支并继续重放', () => {
  const record = new Runner(doc, { runId: 'r' }).runAll(doc.cues);
  const forkPoint = record.engineLog.find((e) => e.type === 'section-skipped').seq;
  const runner = replayFromRecord(record, doc, forkPoint, 'branch-1');
  assert.equal(runner.engine.branchOf, 'r');
  assert.ok(runner.engine.blockedEdges.has('s1->s2'), '分支继承跳段状态');
  const later = doc.cues.filter((c) => c.at > record.engineLog.find((e) => e.seq === forkPoint).at);
  for (const cue of later) runner.step(cue);
  const branchRecord = runner.buildRecord(later);
  assert.ok(branchRecord.engineLog.length > 0);
});

test('舞监自由文本解析：明确词汇才执行，含糊内容转人工', () => {
  assert.equal(parseDirector({ text: 'skip sec-deny' }, doc).op, 'skip');
  assert.equal(parseDirector({ text: 'take s3' }, doc).op, 'take');
  assert.equal(parseDirector({ text: 'encore s1' }, doc).op, 'encore');
  assert.equal(parseDirector({ text: '门厅乙句略过，直接开灯。' }, doc).op, 'unknown',
    '自由文本不含明确段落 id 时不得猜测执行');
  assert.equal(parseDirector({ text: '清屏' }, doc).op, 'blank');
  assert.equal(parseDirector({ op: 'skip', target: 'sec-deny' }, doc).op, 'skip');
});

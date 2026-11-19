import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDocument, buildDocument } from '../src/document.mjs';
import { Engine } from '../src/engine.mjs';
import { Scheduler } from '../src/scheduler.mjs';

const showUrl = new URL('../data/sample-show.json', import.meta.url);
const doc = await loadDocument(showUrl);
const rawShow = () => JSON.parse(readFileSync(showUrl, 'utf8'));
const lastPublish = (eng) => eng.log.filter((e) => e.type === 'publish').at(-1);

test('最短停留内拒绝快速切换，到点才放行', () => {
  const eng = new Engine(doc, { runId: 't' });
  const sch = new Scheduler(doc);
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  sch.ingest(lastPublish(eng), 100);
  const firstEn = sch.screens.get('side-en').frame.frameId;

  eng.applyTake('s3', 150);
  eng.handleHeard('开灯就能看见。', { at: 300 });
  sch.ingest(lastPublish(eng), 300);
  // 英文 minHold=1100，300-100=200 < 1100：新帧排队，旧帧仍在屏
  assert.equal(sch.screens.get('side-en').frame.frameId, firstEn);
  assert.ok(sch.queues.get('side-en').length >= 1);

  // 停留到期点（1200）之后才换帧
  sch.drainUntil(1199);
  assert.equal(sch.screens.get('side-en').frame.frameId, firstEn);
  sch.drainUntil(1200);
  assert.notEqual(sch.screens.get('side-en').frame.frameId, firstEn);
});

test('跳段发布使旧走向的排队帧作废但已播画面留在历史', () => {
  const eng = new Engine(doc, { runId: 't' });
  const sch = new Scheduler(doc);
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  sch.ingest(lastPublish(eng), 100);
  // 构造英文排队帧（1100ms 停留，200ms 时不可能出队）
  eng.applyTake('s2', 150);
  eng.handleHeard('不是我。', { at: 200 });
  sch.ingest(lastPublish(eng), 200);
  assert.ok(sch.queues.get('side-en').length > 0);
  assert.equal(sch.screens.get('side-en').history.length >= 1, true);

  eng.applySkip('sec-deny', 300);
  sch.ingest(lastPublish(eng), 300);
  // 旧走向的排队帧被丢弃并留下记录
  assert.ok(sch.screens.get('side-en').dropped.some((d) => d.reason.includes('失效')));
  assert.ok(sch.screens.get('side-en').history.length >= 1, '已播画面保留在记录');
  const queuedTexts = sch.queues.get('side-en').map((f) => f.text);
  assert.ok(!queuedTexts.includes('I did not take it.'), '被跳过段内容不得留在队列');
});

test('空屏同样受最短停留约束', () => {
  const eng = new Engine(doc, { runId: 't' });
  const sch = new Scheduler(doc);
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  sch.ingest(lastPublish(eng), 100);
  // 英文屏 minHold=1100：提前请求只登记待清
  const early = sch.requestBlank(500);
  assert.equal(early.blanked, false);
  assert.ok(early.pending.some((p) => p.deviceId === 'side-en'));
  assert.notEqual(sch.screens.get('side-en').frame, null, '未到停留不得清空');
  // 到点 drain 完成待清
  sch.drainUntil(1200);
  assert.equal(sch.screens.get('side-en').frame, null);
});

test('超宽字幕被引擎拦截，不会进入调度', () => {
  const longDoc = rawShow();
  longDoc.draft.find((d) => d.id === 'E1').text = `Hereis${'x'.repeat(40)}key.`;
  const eng2 = new Engine(buildDocument(longDoc), { runId: 't2' });
  const sch = new Scheduler(doc);
  eng2.handleHeard('钥匙在这儿。', { at: 100 });
  const ev = lastPublish(eng2);
  const en = ev.frames.find((f) => f.deviceId === 'side-en');
  assert.ok(en.blocked.some((b) => b.reason === '超出设备行宽'));
  sch.ingest(ev, 100);
  assert.equal(sch.queues.get('side-en').length, 0);
});

test('走否认分支后再跳段：被跳过译文从不上屏，已播画面留在历史', () => {
  const eng = new Engine(doc, { runId: 't' });
  const sch = new Scheduler(doc);
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  sch.ingest(lastPublish(eng), 100);
  eng.applyTake('s2', 150);
  eng.handleHeard('不是我。', { at: 200 });           // 否认段内容排队
  sch.ingest(lastPublish(eng), 200);
  eng.applySkip('sec-deny', 400);                    // 舞监确认跳段
  sch.ingest(lastPublish(eng), 400);
  // 推进到远超所有停留
  sch.drainUntil(20000);
  const everShown = sch.screens.get('side-en').history.map((h) => h.text);
  assert.ok(!everShown.includes('I did not take it.'), '跳过段译文任何时刻都不得播出');
  assert.ok(sch.screens.get('side-en').history.length >= 1, '此前已播画面仍在记录');
});

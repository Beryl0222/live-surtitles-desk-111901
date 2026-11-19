import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadDocument, buildDocument } from '../src/document.mjs';
import { Engine } from '../src/engine.mjs';

const showUrl = new URL('../data/sample-show.json', import.meta.url);
const doc = await loadDocument(showUrl);
const fresh = () => new Engine(doc, { runId: 't' });
const rawShow = () => JSON.parse(readFileSync(showUrl));
import { readFileSync } from 'node:fs';

function publishEvents(engine) {
  return engine.log.filter((e) => e.type === 'publish');
}
function frameTexts(engine, deviceId) {
  const last = publishEvents(engine).at(-1);
  return last.frames.find((f) => f.deviceId === deviceId).pages.map((p) => p.text);
}
function lastConfirmed(engine) {
  return engine.log.filter((e) => e.type === 'line-confirmed').at(-1);
}

test('同一句在不同人物/场次产生歧义，未裁决前只能显示交集内容', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });      // s1（门厅/甲）
  eng.applyTake('s3', 200);
  eng.handleHeard('开灯就能看见。', { at: 300 });    // s3
  eng.handleHeard('钥匙在这里。', { at: 400 });      // s4（后场/乙）
  eng.handleHeard('这是一句需要在窄屏上断成多条的很长的中文台词用来检验行宽行数与停留时间限制。', { at: 450 }); // s5
  eng.handleHeard('终场。', { at: 500 });            // s6 -> 前沿 s1
  // 舞监临时让 s4 也返场：s1 与 s4 同台词且同时位于前沿
  eng.applyEncore('s4', 550);
  const publishCountBefore = publishEvents(eng).length;
  const ev = eng.handleHeard('钥匙在这儿。', { at: 600 });
  assert.equal(ev.type, 'heard-ambiguous');
  assert.ok(ev.candidates.includes('s1') && ev.candidates.includes('s4'));
  // 歧义期间不发布新画面
  assert.equal(publishEvents(eng).length, publishCountBefore);
  // 闸门：只有两个候选位置下都允许且意思相同的内容才可继续显示
  const zhGuarded = ev.displayable['side-zh'].map((x) => x.text);
  const enGuarded = ev.displayable['side-en'].map((x) => x.text);
  assert.ok(zhGuarded.includes('钥匙在这里。'), '已说且两位置共有的原文可保留');
  assert.ok(enGuarded.includes('Here is the key.'), '同 meaningId 的同文译文可保留');
});

test('人工裁决歧义后位置确认并正常发布', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  eng.applyTake('s3', 200);
  eng.handleHeard('开灯就能看见。', { at: 300 });
  eng.handleHeard('钥匙在这里。', { at: 400 });
  eng.handleHeard('这是一句需要在窄屏上断成多条的很长的中文台词用来检验行宽行数与停留时间限制。', { at: 450 });
  eng.handleHeard('终场。', { at: 500 });
  eng.applyEncore('s4', 550);
  eng.handleHeard('钥匙在这儿。', { at: 600 }); // 歧义 s1/s4
  eng.resolveAmbiguity('s1', { at: 650 });
  const confirmed = eng.log.filter((e) => e.type === 'line-confirmed');
  assert.equal(confirmed.at(-1).lineId, 's1');
  assert.equal(confirmed.at(-1).occurrenceNo, 2, '返场用法以出现次数区分');
});

test('人物提示可缩小同句歧义', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  eng.applyTake('s3', 200);
  eng.handleHeard('开灯就能看见。', { at: 300 });
  eng.handleHeard('钥匙在这里。', { at: 400 });
  eng.handleHeard('这是一句需要在窄屏上断成多条的很长的中文台词用来检验行宽行数与停留时间限制。', { at: 450 });
  eng.handleHeard('终场。', { at: 500 });
  eng.applyEncore('s4', 550);
  const ev = eng.handleHeard('钥匙在这儿。', { at: 600, speaker: '乙' });
  assert.equal(ev.type, 'line-confirmed');
  assert.equal(lastConfirmed(eng).lineId, 's4');
  assert.equal(lastConfirmed(eng).occurrenceNo, 2);
});

test('无法定位的说法只记录不推进，等待人工', () => {
  const eng = fresh();
  const ev = eng.handleHeard('我完全没印象。', { at: 100 });
  assert.equal(ev.type, 'heard-unmatched');
  assert.deepEqual(eng.frontier, ['s1']);
});

test('跳段后两种语言都不得泄露被跳过内容', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  eng.applySkip('sec-deny', 200); // 封 s1->s2
  // s2 已不可达
  assert.ok(eng.blockedEdges.has('s1->s2'));
  assert.ok(!eng.frontier.includes('s2'));
  eng.handleHeard('开灯就能看见。', { at: 300 }); // s3
  const enTexts = frameTexts(eng, 'side-en');
  assert.ok(!enTexts.some((t) => t.includes('did not take it')), '被跳过段的否定译文不得播出');
  assert.ok(enTexts.includes('The light will reveal it.'));
});

test('临时走向封死未选分支', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  eng.applyTake('s2', 150);
  assert.ok(eng.blockedEdges.has('s1->s3'));
  // s3 不再可能被确认
  const ev = eng.handleHeard('开灯就能看见。', { at: 200 });
  assert.equal(ev.type, 'heard-unmatched');
});

test('未审短句被拦截，不能播出', () => {
  const eng = fresh();
  const ev = eng.requestShortForm('s1', '没印象', { at: 50 });
  assert.equal(ev.type, 'shortform-blocked');
});

test('已批准短句可经人工入口播出', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  eng.applyTake('s2', 150);
  const ev = eng.handleHeard('不是我。', { at: 200 }); // 登记的 shortForm
  assert.equal(ev.type, 'line-confirmed');
  assert.equal(lastConfirmed(eng).shortForm, '不是我。');
  const zh = frameTexts(eng, 'side-zh');
  assert.ok(zh.includes('不是我。'));
});

test('译文分段防止后句笑点/否定提前出现', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  eng.applyTake('s2', 150);
  eng.handleHeard('不是我。', { at: 200 }); // 只说 s2
  const en = frameTexts(eng, 'side-en');
  assert.ok(en.includes('I did not take it.'));
  assert.ok(!en.includes('The light will reveal it.'));
});

test('返场以 occurrence 区分历次用法且可再次上屏', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  eng.applyTake('s3', 150);
  eng.handleHeard('开灯就能看见。', { at: 200 });
  eng.handleHeard('钥匙在这里。', { at: 300 });
  eng.handleHeard('这是一句需要在窄屏上断成多条的很长的中文台词用来检验行宽行数与停留时间限制。', { at: 350 });
  eng.handleHeard('终场。', { at: 400 });
  eng.applyEncore('s1', 500);
  assert.ok(eng.frontier.includes('s1'));
  const ev = eng.handleHeard('钥匙在这儿。', { at: 600, speaker: '甲' });
  assert.equal(ev.type, 'line-confirmed');
  assert.equal(lastConfirmed(eng).occurrenceNo, 2);
});

test('稿本切换找不回当前台词时拒绝并保留旧稿', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  const broken = rawShow();
  // 移除当前前沿中的 s3，同时清理对它的引用使新稿本身仍合法
  broken.script.find((l) => l.id === 's1').next = ['s2'];
  broken.script = broken.script.filter((l) => l.id !== 's3');
  const e2 = broken.draft.find((d) => d.id === 'E2');
  e2.source = e2.source.filter((id) => id !== 's3');
  e2.segments = e2.segments.filter((seg) => !seg.requires.includes('s3'));
  broken.revision = 2;
  const newDoc = buildDocument(broken);
  const r = eng.switchRevision(newDoc, { at: 200 });
  assert.equal(r.safe, false);
  assert.ok(r.note.missingLines.includes('s3'));
  assert.equal(eng.doc.revision, 1, '旧稿保留');
});

test('安全稿本切换通过并重新发布', () => {
  const eng = fresh();
  eng.handleHeard('钥匙在这儿。', { at: 100 });
  const next = rawShow();
  next.revision = 2;
  const r = eng.switchRevision(buildDocument(next), { at: 200 });
  assert.equal(r.safe, true);
  assert.equal(eng.doc.revision, 2);
});

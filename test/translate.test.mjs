import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument } from '../src/document.mjs';
import { sayableSegments, compareRevisions } from '../src/translate.mjs';

const doc = await loadDocument(new URL('../data/sample-show.json', import.meta.url));

test('译稿分段闸门：后句依赖未说时不得提前出现', () => {
  // 只说了 s2（否定），s3（开灯）未说
  const segs = sayableSegments(doc.draft, ['s1', 's2'], [...doc.draft.keys()]);
  const texts = segs.map((s) => s.text);
  assert.ok(texts.includes('I did not take it.'));
  assert.ok(!texts.includes('The light will reveal it.'), '后句身份/笑点信息不得提前泄露');
});

test('依赖全部满足后分段才放行', () => {
  const segs = sayableSegments(doc.draft, ['s1', 's2', 's3'], [...doc.draft.keys()]);
  assert.ok(segs.some((s) => s.text === 'The light will reveal it.'));
});

test('稿本修订：语义漂移与缺译文均判定不安全', () => {
  const oldEntries = doc.draft;
  const changed = new Map(oldEntries);
  const e2 = { ...oldEntries.get('E2'), meaningId: 'm-totally-different' };
  changed.set('E2', e2);
  const r1 = compareRevisions(oldEntries, changed, ['s2']);
  assert.equal(r1.safe, false);
  assert.deepEqual(r1.changed[0].lineId, 's2');

  const removed = new Map(oldEntries);
  removed.delete('E1');
  const r2 = compareRevisions(oldEntries, removed, ['s1']);
  assert.equal(r2.safe, false);
  assert.deepEqual(r2.missing, ['s1']);
});

test('同 meaningId 的译文润色对已说内容保持安全', () => {
  const polished = new Map(doc.draft);
  const e1 = { ...doc.draft.get('E1'), text: 'Here is the key now.' };
  polished.set('E1', e1);
  const r = compareRevisions(doc.draft, polished, ['s1']);
  assert.equal(r.safe, true);
});

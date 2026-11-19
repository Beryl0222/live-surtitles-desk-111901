import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate, wrapLines, fitsDevice } from '../src/layout.mjs';

const en = { id: 'en', language: 'en', columns: 22, lines: 2, minHoldMs: 1100 };
const zh = { id: 'zh', language: 'zh', columns: 10, lines: 2, minHoldMs: 900 };

test('英文按词折行且每页不超过行数与列宽', () => {
  const text = 'I did not take it. The light will reveal it.';
  const { pages, overflow } = paginate(text, en);
  assert.equal(overflow, false);
  for (const page of pages) {
    assert.ok(page.length <= 2);
    for (const line of page) assert.ok(Array.from(line).length <= 22);
  }
  assert.ok(pages.length >= 1); // 同一段英文可在更长文本时断成数条（E5 验证多页）
});

test('长英文译文在窄屏断成数条', () => {
  const text = 'This is a deliberately long English line that must break into several surtitle pages on a narrow side screen while the minimum hold time keeps every page actually readable.';
  const { pages, overflow } = paginate(text, en);
  assert.equal(overflow, false);
  assert.ok(pages.length >= 3);
});

test('中文逐字折行', () => {
  const wrapped = wrapLines('钥匙在这里开灯', 4);
  assert.deepEqual(wrapped, ['钥匙在这', '里开灯']);
});

test('超宽内容标记 overflow 且不得视为可播', () => {
  const long = 'a'.repeat(30);
  const { overflow } = paginate(long, en);
  assert.equal(overflow, true);
  assert.equal(fitsDevice(long, en), false);
  assert.equal(fitsDevice('Here is the key.', en), true);
});

test('长中文台词在 10 列 2 行设备上分成多页', () => {
  const text = '这是一句需要在窄屏上断成多条的很长的中文台词用来检验行宽行数与停留时间限制。';
  const { pages, overflow } = paginate(text, zh);
  assert.equal(overflow, false);
  assert.ok(pages.length >= 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, matchesHeard, codePoints } from '../src/text.mjs';

test('规范化忽略标点空白但保留文字差异', () => {
  assert.equal(normalizeText('钥匙 在这里。'), normalizeText('钥匙在这里'));
  assert.notEqual(normalizeText('钥匙在这里'), normalizeText('钥匙在这儿'));
});

test('码点计数按 Unicode code point，代理对只算一个', () => {
  assert.equal(codePoints('abc'), 3);
  assert.equal(codePoints('钥匙'), 2);
  assert.equal(codePoints('😀'), 1);
});

test('台词匹配只接受原文、登记变体与已批准短句', () => {
  const line = { text: '不是我拿的。钥匙在这里。', variants: ['钥匙在这儿。'], shortForms: ['不是我。'] };
  assert.ok(matchesHeard(line, '不是我拿的，钥匙在这里'));
  assert.ok(matchesHeard(line, '钥匙在这儿。'));
  assert.ok(matchesHeard(line, '不是我'));
  // 未登记的泛前缀/猜测一律不匹配
  assert.ok(!matchesHeard(line, '不是'));
  assert.ok(!matchesHeard(line, '我完全没印象'));
});

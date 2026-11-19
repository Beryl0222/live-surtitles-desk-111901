import test from 'node:test';
import assert from 'node:assert/strict';
import { readInputs } from '../scripts/inspect.mjs';
import { buildDocument } from '../src/document.mjs';
import { Engine } from '../src/engine.mjs';
import { Runner } from '../src/rehearsal.mjs';

// 兼容早期扁平 inputs.json（无 sections/variants，译稿为整段 text）
const raw = await readInputs();
const doc = buildDocument(raw);

test('旧版 inputs.json 可直接构建文档并跑通 cues', () => {
  assert.ok(doc.script.lines.has('s4'));
  assert.equal(doc.draft.get('E2').segments.length, 1, '整段译稿归一化为单段');
  const record = new Runner(doc, { runId: 'legacy' }).runAll(doc.cues);
  // “钥匙在这儿。”未登记变体且非短句 -> 无法定位（旧数据无 variants）
  assert.ok(record.engineLog.some((e) => e.type === 'heard-unmatched'));
  // 舞监自由文本无段落 id -> unknown，不猜测
  assert.ok(record.engineLog.some((e) => e.type === 'director-unknown'));
});

test('旧数据中精确台词仍可确认并上屏双语', () => {
  const eng = new Engine(doc, { runId: 'legacy-2' });
  eng.handleHeard('钥匙在这里。', { at: 100 });
  const last = eng.log.at(-1);
  assert.equal(last.type, 'publish');
  const zh = last.frames.find((f) => f.deviceId === 'side-zh');
  const en = last.frames.find((f) => f.deviceId === 'side-en');
  assert.ok(zh.pages.some((p) => p.text === '钥匙在这里。'));
  assert.ok(en.pages.some((p) => p.text === 'Here is the key.'));
});

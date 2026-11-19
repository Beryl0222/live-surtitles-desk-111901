import test from 'node:test';
import assert from 'node:assert/strict';
import { readInputs } from '../scripts/inspect.mjs';

const data = await readInputs();

test("后继场景与译稿的剧本引用可解析", () => {
  const ids = new Set(data.script.map(line => line.id));
  assert.equal(ids.size, data.script.length);
  for (const line of data.script) assert.ok(line.next.every(id => ids.has(id)));
  for (const draft of data.draft) assert.ok(draft.source.every(id => ids.has(id)));
  assert.ok(data.cues.every((cue, index) => index === 0 || cue.at >= data.cues[index - 1].at));
});

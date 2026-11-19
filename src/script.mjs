// 剧本图：校验、可达前沿、场次/人物维度的匹配。
import { matchesHeard } from './text.mjs';

export class ScriptError extends Error {}

/** 校验剧本引用完整性与段落定义，返回归一化的剧本对象。 */
export function normalizeScript(script, sections = []) {
  const lines = new Map();
  for (const line of script) {
    if (lines.has(line.id)) throw new ScriptError(`重复台词 id: ${line.id}`);
    lines.set(line.id, { variants: [], shortForms: [], next: [], ...line });
  }
  for (const line of lines.values()) {
    for (const id of line.next) {
      if (!lines.has(id)) throw new ScriptError(`${line.id} 的后继 ${id} 不存在`);
    }
  }
  const sectionById = new Map();
  for (const sec of sections) {
    if (sectionById.has(sec.id)) throw new ScriptError(`重复段落 id: ${sec.id}`);
    for (const id of sec.lines) {
      if (!lines.has(id)) throw new ScriptError(`段落 ${sec.id} 引用不存在的台词 ${id}`);
    }
    sectionById.set(sec.id, sec);
  }
  return { lines, sections: sectionById };
}

/**
 * 起始台词：无前驱的节点；若整图成环（如终场回边构成返场环），
 * 则退化为环中按 id 稳定排序的第一个节点。
 */
export function entryLines(script) {
  const hasIncoming = new Set();
  for (const line of script.lines.values()) {
    for (const id of line.next) hasIncoming.add(id);
  }
  const roots = [...script.lines.values()].filter((l) => !hasIncoming.has(l.id)).map((l) => l.id);
  if (roots.length) return roots;
  return [[...script.lines.keys()].sort()[0]];
}

/** 去掉已跳过边后，某台词当前允许的后继。 */
export function allowedNext(script, lineId, blockedEdges) {
  const line = script.lines.get(lineId);
  if (!line) return [];
  return line.next.filter((to) => !blockedEdges.has(edgeKey(lineId, to)));
}

export function edgeKey(from, to) {
  return `${from}->${to}`;
}

/**
 * 在候选台词中按听到的说法匹配。
 * candidates 为 occurrence（{lineId, scene, speaker, occurrenceNo}）。
 * 可选 speaker 来自舞监提示，用于缩小同句不同人物的歧义。
 */
export function matchCandidates(script, candidates, heard, speaker = null) {
  let pool = candidates;
  if (speaker) pool = candidates.filter((c) => c.speaker === speaker);
  return pool.filter((c) => matchesHeard(script.lines.get(c.lineId), heard));
}

/** 一段跳过操作后，仍可从前沿到达的台词（用于判断已排期画面是否失效）。 */
export function reachableFrom(script, frontier, blockedEdges) {
  const seen = new Set();
  const stack = [...frontier];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const to of allowedNext(script, id, blockedEdges)) stack.push(to);
  }
  return seen;
}

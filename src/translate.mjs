// 译稿闸门：译文只有在它所覆盖的原句实际被说过后才可上屏；
// 分段译文逐段放行，避免笑点/否定/身份提前泄露。
import { normalizeText } from './text.mjs';

export class DraftError extends Error {}

/** 归一化译稿：旧式整段 text 变为单段（requires = 全部 source）。 */
export function normalizeDraft(draft, scriptLines) {
  const entries = new Map();
  for (const d of draft) {
    if (entries.has(d.id)) throw new DraftError(`重复译稿 id: ${d.id}`);
    for (const id of d.source) {
      if (!scriptLines.has(id)) throw new DraftError(`译稿 ${d.id} 引用不存在的台词 ${id}`);
    }
    let segments;
    if (Array.isArray(d.segments) && d.segments.length) {
      segments = d.segments.map((seg) => ({
        requires: [...seg.requires],
        text: seg.text,
      }));
      for (const seg of segments) {
        for (const id of seg.requires) {
          if (!d.source.includes(id)) {
            throw new DraftError(`译稿 ${d.id} 分段依赖 ${id} 不在 source 内`);
          }
        }
      }
    } else {
      segments = [{ requires: [...d.source], text: d.text }];
    }
    entries.set(d.id, {
      ...d,
      meaningId: d.meaningId ?? d.id,
      segments,
      approvedShortForms: d.approvedShortForms ?? [],
    });
  }
  return entries;
}

/**
 * 当前可上屏的分段：requires 中的原句全部已说。
 * 返回 [{ entryId, index, text }]，按 source 顺序稳定排序。
 */
export function sayableSegments(entries, spokenIds, ordering) {
  const spoken = new Set(spokenIds);
  const out = [];
  for (const entryId of ordering) {
    const entry = entries.get(entryId);
    if (!entry) continue;
    entry.segments.forEach((seg, index) => {
      if (seg.requires.every((id) => spoken.has(id))) {
        out.push({ entryId, index, text: seg.text, meaningId: entry.meaningId });
      }
    });
  }
  return out;
}

/** 已批准英文短句匹配（听到的中文短句可对应播出）。 */
export function matchApprovedShort(entry, heardText) {
  const h = normalizeText(heardText);
  return entry.approvedShortForms.find((t) => normalizeText(t) === h) ?? null;
}

/**
 * 稿本切换安全检查：新版本对“已说过的台词”是否仍有同 meaningId 的译文。
 * missing：新稿缺译文；changed：meaningId 漂移（语义可能已变）。
 */
export function compareRevisions(oldEntries, newEntries, spokenIds) {
  const missing = [];
  const changed = [];
  const coveredByOld = new Map(); // lineId -> meaningId
  for (const e of oldEntries.values()) {
    for (const id of e.source) coveredByOld.set(id, e.meaningId);
  }
  const coveredByNew = new Map();
  for (const e of newEntries.values()) {
    for (const id of e.source) coveredByNew.set(id, e.meaningId);
  }
  for (const lineId of spokenIds) {
    if (!coveredByOld.has(lineId)) continue;
    if (!coveredByNew.has(lineId)) {
      missing.push(lineId);
    } else if (coveredByNew.get(lineId) !== coveredByOld.get(lineId)) {
      changed.push({ lineId, from: coveredByOld.get(lineId), to: coveredByNew.get(lineId) });
    }
  }
  return { safe: missing.length === 0 && changed.length === 0, missing, changed };
}

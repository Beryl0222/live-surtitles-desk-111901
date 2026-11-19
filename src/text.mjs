// 文本规范化与匹配：只依赖已批准的人工说法，不做模糊语义猜测。

const PUNCT_OR_SPACE = /[\s\p{P}]/gu;

/** NFKC + 去除空白与标点，用于“同一句话”的精确判定。 */
export function normalizeText(text) {
  return String(text ?? '').normalize('NFKC').replace(PUNCT_OR_SPACE, '');
}

/** 以 Unicode 码点计长（与设备配置的 unit 对齐）。 */
export function codePoints(text) {
  return Array.from(String(text ?? '')).length;
}

/**
 * 判定听到的说法是否匹配某句台词。
 * 允许：完全相等、台词登记的 variants、已批准 shortForm（整体或前缀命中）。
 * 不允许：未登记的泛前缀/包含猜测。
 */
export function matchesHeard(line, heard) {
  const h = normalizeText(heard);
  if (h.length === 0) return false;
  const candidates = [line.text, ...(line.variants ?? [])];
  if (candidates.some((t) => normalizeText(t) === h)) return true;
  for (const short of line.shortForms ?? []) {
    const s = normalizeText(short);
    // 只接受与已批准短句完全一致的说法，不做泛前缀猜测
    if (s && s === h) return true;
  }
  return false;
}

/** 听到的说法是否对应某条已批准短句（用于请求 shortForm 上屏）。 */
export function findApprovedShortForm(line, heard) {
  const h = normalizeText(heard);
  for (const short of line.shortForms ?? []) {
    if (normalizeText(short) === h) return short;
  }
  return null;
}

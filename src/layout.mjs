// 设备断条：按 Unicode 码点的行宽/行数分页，超长即拒绝上屏。
import { codePoints } from './text.mjs';

/**
 * 按 columns 折行（英文按空格分词，CJK 逐字折行）。
 * 返回字符串行数组；单个长于 columns 的词会占一整行并标记溢出。
 */
export function wrapLines(text, columns) {
  const out = [];
  let line = '';
  const push = () => {
    if (line.length) out.push(line);
    line = '';
  };
  for (const rawWord of String(text).split(/(\s+)/)) {
    if (/^\s+$/.test(rawWord)) {
      if (codePoints(line) + 1 <= columns) line += rawWord;
      continue;
    }
    if (!rawWord) continue;
    // 含 CJK 的词按码点细拆
    const pieces = /[㐀-鿿豈-﫿]/.test(rawWord)
      ? Array.from(rawWord)
      : [rawWord];
    for (const piece of pieces) {
      if (codePoints(piece) > columns) {
        push();
        out.push(piece);
        continue;
      }
      if (codePoints(line) + codePoints(piece) > columns) push();
      line += piece;
    }
  }
  push();
  return out.map((l) => l.trimEnd());
}

/**
 * 将一条字幕文本切成设备可显示的页面（每页最多 lines 行、每行 columns 码点）。
 * 返回 { pages: string[][], overflow: boolean }。
 */
export function paginate(text, device) {
  const { columns, lines } = device;
  const wrapped = wrapLines(text, columns);
  const overflow = wrapped.some((l) => codePoints(l) > columns);
  const pages = [];
  for (let i = 0; i < wrapped.length; i += lines) {
    pages.push(wrapped.slice(i, i + lines));
  }
  return { pages: pages.length ? pages : [['']], overflow };
}

/** 设备是否能完整承载该文本（不超宽、可分页）。 */
export function fitsDevice(text, device) {
  const { overflow } = paginate(text, device);
  return !overflow;
}

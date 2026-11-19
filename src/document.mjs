// 稿本文档加载与校验；兼容早期 inputs.json（无 sections/variants 的扁平格式）。
import { readFile } from 'node:fs/promises';
import { normalizeScript } from './script.mjs';
import { normalizeDraft } from './translate.mjs';

export class DocumentError extends Error {}

/** 将任意版本的输入归一化为 Show 文档。 */
export function buildDocument(raw) {
  if (!Array.isArray(raw.script) || raw.script.length === 0) {
    throw new DocumentError('script 为空');
  }
  const script = normalizeScript(raw.script, raw.sections ?? []);
  const draft = normalizeDraft(raw.draft ?? [], script.lines);
  const devices = [];
  for (const d of raw.devices ?? []) {
    if (!Number.isInteger(d.columns) || !Number.isInteger(d.lines) ||
        !Number.isInteger(d.minHoldMs) || d.columns <= 0 || d.lines <= 0 || d.minHoldMs < 0) {
      throw new DocumentError(`设备 ${d.id} 的 columns/lines/minHoldMs 非法`);
    }
    devices.push({ ...d });
  }
  // 译文 source 必须可解析（normalizeDraft 已校验）；设备语言要有对应译文或原文
  const languages = new Set(devices.map((d) => d.language));
  for (const lang of languages) {
    if (lang !== 'zh' && ![...draft.values()].some((e) => e.language === lang)) {
      throw new DocumentError(`语言 ${lang} 没有任何译稿条目`);
    }
  }
  return {
    version: raw.version ?? 'untitled',
    revision: raw.revision ?? 1,
    script,
    draft,
    devices,
    cues: Array.isArray(raw.cues) ? raw.cues : [],
    sections: raw.sections ?? [],
  };
}

export async function loadDocument(file) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  return buildDocument(raw);
}

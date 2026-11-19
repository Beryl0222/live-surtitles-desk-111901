// 舞监段落提示解析：结构化指令优先，中文自由文本仅识别明确的跳段/重演/走向词汇。
// 解析失败返回 { op: 'unknown' }，调用方必须记为待人工处理，绝不猜测执行。

export function parseDirector(cue, doc) {
  const text = String(cue.text ?? '').trim();
  const structured = cue.op ? cue : parseFreeText(text);
  return validate(structured, doc, text);
}

function parseFreeText(text) {
  // 结构化英文指令：skip sec-x / take s3 / encore s1 / resolve s1 / blank
  const m = text.match(/^(skip|take|encore|blank|goto|resolve)(?:\s+([\w-]+))?$/i);
  if (m) return { op: m[1].toLowerCase(), target: m[2] ?? null };

  if (/清屏|空屏|撤屏/.test(text)) return { op: 'blank' };

  const resolve = text.match(/(?:判定|确认位置|位置在|按)\s*([\w-]+)/);
  if (resolve) return { op: 'resolve', target: resolve[1] };

  const skip = text.match(/(?:略过|跳过|删去?|省去?)(?:段落)?\s*([\w-]+|[一-鿿]{1,12}段)?/);
  if (skip) return { op: 'skip', target: skip[1] ?? null };

  const encore = text.match(/(?:返场|重演|再来一次|重演)\s*([\w-]+)?/);
  if (encore) return { op: 'encore', target: encore[1] ?? null };

  const take = text.match(/(?:走向|走|选|接)\s*([\w-]+)/);
  if (take) return { op: 'take', target: take[1] };

  return { op: 'unknown', target: null, raw: text };
}

function validate(op, doc, raw) {
  const base = { ...op, raw };
  switch (op.op) {
    case 'blank':
      return base;
    case 'skip': {
      const sec = op.target && doc.script.sections.get(op.target);
      if (!sec) return { ...base, op: 'unknown', reason: `段落 ${op.target} 不存在` };
      return base;
    }
    case 'take':
    case 'encore':
    case 'goto':
    case 'resolve': {
      if (!op.target || !doc.script.lines.has(op.target)) {
        return { ...base, op: 'unknown', reason: `台词 ${op.target} 不存在` };
      }
      return base;
    }
    default:
      return { ...base, op: 'unknown', raw };
  }
}

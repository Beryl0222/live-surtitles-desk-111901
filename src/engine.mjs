// 现场引擎：位置识别 + 歧义闸门 + 跳段/返场 + 双语可播内容计算。
import { entryLines, allowedNext, edgeKey, matchCandidates, reachableFrom } from './script.mjs';
import { sayableSegments, matchApprovedShort } from './translate.mjs';
import { findApprovedShortForm } from './text.mjs';
import { paginate } from './layout.mjs';
import { parseDirector } from './director.mjs';

let runSeq = 0;

export class Engine {
  constructor(doc, { runId = `run-${Date.now()}-${++runSeq}`, branchOf = null } = {}) {
    this.doc = doc;
    this.runId = runId;
    this.branchOf = branchOf;
    this.startedAt = null;
    this.ended = false;
    this.frontier = entryLines(doc.script); // 尚未说、但接下来可能说的台词
    this.activeSpoken = new Set();           // 当前走向中已实际说过、画面仍可能停留的台词
    this.blockedEdges = new Set();
    this.spoken = [];                        // 已确认的 occurrence（按时间）
    this.occurrenceCount = new Map();        // lineId -> 次数（区分故意返场）
    this.ambiguity = null;                   // 未决歧义
    this.log = [];
    this.revisionNotes = [];
  }

  // ---------- 日志 ----------
  record(type, detail) {
    const ev = { seq: this.log.length, type, ...detail };
    this.log.push(ev);
    return ev;
  }

  snapshot() {
    return {
      runId: this.runId,
      branchOf: this.branchOf,
      ended: this.ended,
      frontier: [...this.frontier],
      activeSpoken: [...this.activeSpoken],
      blockedEdges: [...this.blockedEdges],
      spoken: this.spoken.map((o) => ({ ...o })),
      ambiguity: this.ambiguity ? { ...this.ambiguity, candidates: this.ambiguity.candidates.map((c) => ({ ...c })) } : null,
      revisionNotes: [...this.revisionNotes],
    };
  }

  // ---------- 候选 occurrence ----------
  candidateOccurrences(speaker = null) {
    return this.frontier
      .map((lineId) => {
        const line = this.doc.script.lines.get(lineId);
        return {
          lineId,
          scene: line.scene,
          speaker: line.speaker,
          occurrenceNo: (this.occurrenceCount.get(lineId) ?? 0) + 1,
        };
      })
      .filter((c) => !speaker || c.speaker === speaker);
  }

  // ---------- 听到一句 ----------
  handleHeard(heard, { at, speaker = null } = {}) {
    this.startedAt ??= at;
    if (this.ended) return this.record('heard-after-end', { at, heard });

    const matches = matchCandidates(this.doc.script, this.candidateOccurrences(speaker), heard, speaker);
    if (matches.length === 0) {
      return this.record('heard-unmatched', { at, heard, frontier: [...this.frontier] });
    }
    if (matches.length > 1) {
      const frames = this.guardedFrames(matches);
      this.ambiguity = { heard, at, candidates: matches, guardedFrames: frames.guarded };
      this.record('heard-ambiguous', {
        at, heard,
        candidates: matches.map((c) => c.lineId),
        displayable: Object.fromEntries(frames.guarded),
      });
      return this.log.at(-1);
    }
    this.confirmOccurrence(matches[0], heard, at);
    return this.log.at(-2);
  }

  /** 字幕员在歧义列表中人工选定位置。 */
  resolveAmbiguity(lineId, { at } = {}) {
    if (!this.ambiguity) return this.record('resolve-without-ambiguity', { at, lineId });
    const pick = this.ambiguity.candidates.find((c) => c.lineId === lineId);
    if (!pick) return this.record('resolve-invalid', { at, lineId });
    const { heard } = this.ambiguity;
    this.confirmOccurrence(pick, heard, at);
    return this.log.at(-2);
  }

  confirmOccurrence(occ, heard, at) {
    const { lineId, occurrenceNo } = occ;
    const line = this.doc.script.lines.get(lineId);
    const shortForm = findApprovedShortForm(line, heard);
    this.spoken.push({ lineId, occurrenceNo, heard, at, shortForm });
    this.occurrenceCount.set(lineId, occurrenceNo);
    this.ambiguity = null;
    // 已说句子移出待匹配前沿、进入活动已说集合；后继加入前沿
    this.frontier = [...new Set([
      ...this.frontier.filter((id) => id !== lineId),
      ...allowedNext(this.doc.script, lineId, this.blockedEdges),
    ])];
    this.activeSpoken.add(lineId);
    if (this.frontier.length === 0) this.ended = true;
    this.record('line-confirmed', {
      at, lineId, occurrenceNo, heard,
      shortForm: shortForm ?? null,
      scene: line.scene, speaker: line.speaker,
    });
    this.publish(at);
    return this.log.at(-2);
  }

  // ---------- 舞监指令 ----------
  handleDirector(cue, { at } = {}) {
    this.startedAt ??= at;
    const cmd = parseDirector(cue, this.doc);
    if (cmd.op === 'unknown') {
      return this.record('director-unknown', { at, text: cue.text ?? cmd.raw, reason: cmd.reason ?? '无法解析' });
    }
    if (cmd.op === 'blank') {
      return this.record('director-blank', { at });
    }
    if (cmd.op === 'skip') return this.applySkip(cmd.target, at);
    if (cmd.op === 'take') return this.applyTake(cmd.target, at);
    if (cmd.op === 'encore') return this.applyEncore(cmd.target, at);
    if (cmd.op === 'goto') return this.applyGoto(cmd.target, at);
    if (cmd.op === 'resolve') return this.resolveAmbiguity(cmd.target, { at });
    return this.record('director-unknown', { at, text: cue.text });
  }

  /** 跳段：封死段落入口边，前沿与活动已说集合中的段落台词全部移除，防止旧走向泄露。 */
  applySkip(sectionId, at) {
    const sec = this.doc.script.sections.get(sectionId);
    if (!sec) return this.record('skip-invalid', { at, sectionId });
    const inSection = new Set(sec.lines);
    const before = new Set(this.frontier);
    for (const exit of sec.exits ?? []) {
      this.blockedEdges.add(edgeKey(exit.from, exit.to));
    }
    this.frontier = this.frontier.filter((id) => !inSection.has(id));
    const removedActive = [...this.activeSpoken].filter((id) => inSection.has(id));
    for (const id of removedActive) this.activeSpoken.delete(id);
    this.ambiguity = null;
    const reachable = reachableFrom(this.doc.script, this.frontier, this.blockedEdges);
    if (this.frontier.length === 0) this.ended = true;
    this.record('section-skipped', {
      at, sectionId,
      blockedEdges: sec.exits?.map((e) => edgeKey(e.from, e.to)) ?? [],
      removedFromFrontier: [...before].filter((id) => !this.frontier.includes(id)),
      removedActive,
      reachable: [...reachable],
    });
    return this.publish(at, { reason: 'skip' });
  }

  /** 临时走向：在当前某句的允许后继中选定一条，封死同句其他分支。 */
  applyTake(lineId, at) {
    const owner = this.frontier.find((id) =>
      allowedNext(this.doc.script, id, this.blockedEdges).includes(lineId))
      ?? [...this.activeSpoken].find((id) =>
        allowedNext(this.doc.script, id, this.blockedEdges).includes(lineId));
    if (!owner) {
      return this.record('take-invalid', { at, lineId, reason: '目标不在当前允许后继中' });
    }
    for (const to of allowedNext(this.doc.script, owner, this.blockedEdges)) {
      if (to !== lineId) this.blockedEdges.add(edgeKey(owner, to));
    }
    // 被封死的分支台词从待匹配前沿移除
    this.frontier = this.frontier.filter((id) =>
      id === lineId || !this.doc.script.lines.get(owner).next.includes(id));
    this.record('branch-taken', { at, owner, lineId });
    return this.publish(at);
  }

  /** 故意返场：把某句重新放回待匹配前沿，出现次数递增以区分历次用法。 */
  applyEncore(lineId, at) {
    if (!this.doc.script.lines.has(lineId)) return this.record('encore-invalid', { at, lineId });
    this.activeSpoken.delete(lineId);
    if (!this.frontier.includes(lineId)) this.frontier.push(lineId);
    this.ambiguity = null;
    this.record('encore', { at, lineId, nextOccurrence: (this.occurrenceCount.get(lineId) ?? 0) + 1 });
    return this.publish(at, { reason: 'encore' });
  }

  /** 直接跳转（重练入口）：前沿重置为单句，封死全部旧边。 */
  applyGoto(lineId, at) {
    if (!this.doc.script.lines.has(lineId)) return this.record('goto-invalid', { at, lineId });
    this.frontier = [lineId];
    this.activeSpoken.clear();
    this.ambiguity = null;
    this.record('goto', { at, lineId });
    return this.publish(at);
  }

  // ---------- 可播内容 ----------
  spokenIds() {
    return this.spoken.map((o) => o.lineId);
  }

  /**
   * 歧义闸门：只有每个候选位置下“都允许且意思相同”的内容才可继续显示。
   * 交集基于当前已说集合（候选均未确认，不把候选句本身计入）。
   * 无交集则投屏保持旧画面或空屏。
   */
  guardedFrames(candidates) {
    const perDevice = new Map();
    const base = new Set(this.activeSpoken);
    for (const device of this.doc.devices) {
      const optionSets = candidates.map(() => this.allSayable(device, base));
      const guarded = optionSets.reduce((a, b) =>
        a.filter((x) => b.some((y) => x.key === y.key && x.text === y.text)));
      perDevice.set(device.id, guarded);
    }
    return { guarded: perDevice };
  }

  /** 某设备在当前活动已说集合下“最新一次确认”应发布的增量文本块。 */
  desiredTexts(device, spokenSet = new Set(this.activeSpoken)) {
    const last = this.spoken.at(-1);
    if (device.language === 'zh') {
      // 增量发布：只取最近一次确认台词所产生、且仍处于活动集合的内容
      if (!last || !spokenSet.has(last.lineId)) return [];
      const line = this.doc.script.lines.get(last.lineId);
      return [{
        key: `zh:${last.lineId}:${last.occurrenceNo}`,
        text: last.shortForm ?? line.text,
        sourceLine: last.lineId,
      }];
    }
    // 译文：发布所有“因最近一次确认而新解锁”的分段（覆盖该句的条目内、依赖刚满足的段）
    if (!last) return [];
    const ordering = [...this.doc.draft.keys()];
    const segs = sayableSegments(this.doc.draft, [...spokenSet], ordering);
    return segs
      .filter((s) => {
        const entry = this.doc.draft.get(s.entryId);
        return entry.source.includes(last.lineId) &&
          entry.segments[s.index].requires.includes(last.lineId);
      })
      .map((s) => ({
        key: `${s.entryId}:${s.index}:${s.meaningId}`,
        text: s.text,
        meaningId: s.meaningId,
        entryId: s.entryId,
      }));
  }

  /** 某设备当前全部可说内容（用于歧义闸门交集，不做增量裁剪）。 */
  allSayable(device, spokenSet = new Set(this.activeSpoken)) {
    if (device.language === 'zh') {
      const out = [];
      for (const occ of this.spoken) {
        if (!spokenSet.has(occ.lineId)) continue;
        const line = this.doc.script.lines.get(occ.lineId);
        out.push({ key: `zh:${occ.lineId}:${occ.occurrenceNo}`, text: occ.shortForm ?? line.text });
      }
      return dedupeByText(out);
    }
    const segs = sayableSegments(this.doc.draft, [...spokenSet], [...this.doc.draft.keys()]);
    return dedupeByText(segs.map((s) => ({
      key: `${s.entryId}:${s.index}:${s.meaningId}`,
      text: s.text,
      meaningId: s.meaningId,
    })));
  }

  /** 计算一次发布事件：逐设备分页，超宽/未批准内容拒绝上屏。 */
  publish(at, extra = {}) {
    this.renderSeq = (this.renderSeq ?? 0) + 1;
    const frames = [];
    const stale = this.collectStale(extra.reason);
    for (const device of this.doc.devices) {
      const desired = this.desiredTexts(device);
      const pages = [];
      const blocked = [];
      for (const item of desired) {
        // 所有进入 desired 的原文/译文都已在匹配与稿本归一化阶段完成审批；
        // 未批准短句在更早的匹配环节即被拒绝，不会到达这里。
        const result = paginate(item.text, device);
        if (result.overflow) {
          blocked.push({ item: item.key, reason: '超出设备行宽' });
          continue;
        }
        for (const [i, page] of result.pages.entries()) {
          pages.push({
            frameId: `${item.key}#${i}`,
            itemKey: item.key,
            renderSeq: this.renderSeq,
            text: item.text,
            pageIndex: i,
            pageCount: result.pages.length,
            lines: page,
            sourceLine: item.sourceLine ?? null,
          });
        }
      }
      frames.push({ deviceId: device.id, language: device.language, pages, blocked });
    }
    return this.record('publish', { at, renderSeq: this.renderSeq, frames, stale, ...extra });
  }

  /**
   * 收集本次发布后已失效（不再可说）且确实说过的帧：跳段/返场等操作可能让在屏旧画面失效。
   * 只标记对应语言设备、且依据“已说但不在活动集合”或“分段依赖已失效”判定。
   */
  collectStale(reason) {
    if (!reason) return [];
    const stale = [];
    for (const device of this.doc.devices) {
      const valid = new Set(this.allSayable(device).map((x) => x.key));
      if (device.language === 'zh') {
        for (const occ of this.spoken) {
          const key = `zh:${occ.lineId}:${occ.occurrenceNo}`;
          if (!this.activeSpoken.has(occ.lineId) && !valid.has(key)) {
            stale.push({ deviceId: device.id, itemKey: key });
          }
        }
        continue;
      }
      for (const entry of this.doc.draft.values()) {
        if (entry.language !== device.language) continue;
        entry.segments.forEach((seg, index) => {
          const key = `${entry.id}:${index}:${entry.meaningId}`;
          if (valid.has(key)) return;
          // 仅当该分段依赖的原句“曾经说过”但已不在活动集合时才视为失效
          const everSpoken = seg.requires.some((id) => this.spoken.some((o) => o.lineId === id));
          const nowInactive = seg.requires.some((id) => !this.activeSpoken.has(id));
          if (everSpoken && nowInactive) stale.push({ deviceId: device.id, itemKey: key });
        });
      }
    }
    return dedupeStale(stale);
  }

  /** 请求以某条已批准英文短句上屏（人工批准入口）。 */
  requestShortForm(lineId, heard, { at } = {}) {
    const line = this.doc.script.lines.get(lineId);
    if (!line) return this.record('shortform-invalid', { at, lineId, reason: '台词不存在' });
    const entries = [...this.doc.draft.values()].filter((e) => e.source.includes(lineId));
    for (const entry of entries) {
      const approved = matchApprovedShort(entry, heard);
      if (approved) {
        this.record('shortform-approved', { at, lineId, entryId: entry.id, text: approved });
        return this.publish(at);
      }
    }
    return this.record('shortform-blocked', { at, lineId, heard, reason: '未审短句，禁止播出' });
  }

  // ---------- 稿本切换 ----------
  /**
   * 切换稿本修订版。找不回当前台词或已批准译文语义变化时：
   * 返回 safe=false，调用方应保留旧稿或清屏并提示人工决定。
   */
  switchRevision(newDoc, { at } = {}) {
    const currentIds = new Set([...this.frontier, ...this.spokenIds()]);
    const missingLines = [...currentIds].filter((id) => !newDoc.script.lines.has(id));
    const { missing, changed } = compareDraft(this.doc.draft, newDoc.draft, this.spokenIds());
    const safe = missingLines.length === 0 && missing.length === 0 && changed.length === 0;
    const note = {
      at, safe,
      missingLines, missingTranslations: missing, changedMeanings: changed,
      newRevision: newDoc.revision,
    };
    this.revisionNotes.push(note);
    this.record('revision-check', note);
    if (!safe) {
      this.record('revision-rejected', { at, note });
      return { safe: false, note };
    }
    this.doc = newDoc;
    this.record('revision-applied', { at, newRevision: newDoc.revision });
    this.publish(at);
    return { safe: true, note };
  }

  /** 从某次已确认 occurrence 开出练习分支（保留原记录，分支独立）。 */
  branchAt(seq, newRunId) {
    const fork = new Engine(this.doc, { runId: newRunId, branchOf: this.runId });
    fork.startedAt = this.startedAt;
    const upto = this.spoken.filter((o) => this.log.find((e) =>
      e.type === 'line-confirmed' && e.lineId === o.lineId && e.occurrenceNo === o.occurrenceNo && e.seq <= seq));
    fork.spoken = upto.map((o) => ({ ...o }));
    for (const o of fork.spoken) {
      fork.occurrenceCount.set(o.lineId, o.occurrenceNo);
      fork.activeSpoken.add(o.lineId);
    }
    const last = upto[upto.length - 1];
    if (last) {
      fork.frontier = allowedNext(this.doc.script, last.lineId, this.blockedEdges);
      fork.blockedEdges = new Set(this.blockedEdges);
    }
    fork.record('branch-created', { at: last?.at ?? null, fromRun: this.runId, atSeq: seq });
    return fork;
  }
}

function compareDraft(oldEntries, newEntries, spokenIds) {
  const missing = [];
  const changed = [];
  const oldMap = new Map();
  const newMap = new Map();
  for (const e of oldEntries.values()) for (const id of e.source) oldMap.set(id, e.meaningId);
  for (const e of newEntries.values()) for (const id of e.source) newMap.set(id, e.meaningId);
  for (const id of spokenIds) {
    if (!oldMap.has(id)) continue;
    if (!newMap.has(id)) missing.push(id);
    else if (newMap.get(id) !== oldMap.get(id)) {
      changed.push({ lineId: id, from: oldMap.get(id), to: newMap.get(id) });
    }
  }
  return { missing, changed };
}

function dedupeByText(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const sig = `${item.key}|${item.text}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }
  return out;
}

function dedupeStale(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const sig = `${item.deviceId}|${item.itemKey}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }
  return out;
}

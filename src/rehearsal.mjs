// 排练：按 cues 时间线驱动引擎与调度器，落盘记录，并生成复查报告与练习分支。
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { Engine } from './engine.mjs';
import { Scheduler } from './scheduler.mjs';

/**
 * 离线/可复跑的时间线执行器。时钟由 cues 的 at 驱动（虚拟时钟），
 * 因此同一份 cues 重练时停留限制与提示时间完全一致。
 */
export class Runner {
  constructor(doc, { runId, branchOf = null, sink = null } = {}) {
    this.engine = new Engine(doc, { runId, branchOf });
    this.scheduler = new Scheduler(doc);
    this.sink = sink; // 可选：实时推送（SSE hub）
    this.timeline = [];
  }

  /** 处理单条 cue（at 毫秒）。 */
  step(cue) {
    const at = cue.at;
    const seqBefore = this.engine.log.length;
    let blankEvent = null;
    if (cue.kind === 'heard') {
      this.engine.handleHeard(cue.text, { at, speaker: cue.speaker ?? null });
    } else if (cue.kind === 'director') {
      const ev = this.engine.handleDirector(cue, { at });
      if (ev?.type === 'director-blank') blankEvent = ev;
    } else {
      this.engine.record('unknown-cue', { at, cue });
    }
    // 本 cue 产生的发布事件（确认/跳段/返场等都会 publish）
    const newEvents = this.engine.log.slice(seqBefore);
    const publishEvent = newEvents.filter((e) => e.type === 'publish').at(-1);
    if (publishEvent) {
      const updates = this.scheduler.ingest(publishEvent, at);
      this.timeline.push({ at, kind: 'publish', eventSeq: publishEvent.seq, updates });
      this.sink?.('publish', { at, frames: publishEvent.frames });
    } else {
      // 非发布 cue（未匹配台词、舞监动作等）同样推进虚拟时间，驱动待清/待释放帧
      const updates = this.scheduler.tick(at);
      if (updates.length) this.timeline.push({ at, kind: 'held-release', updates });
    }
    if (blankEvent) {
      const result = this.scheduler.requestBlank(at, 'director');
      this.timeline.push({ at, kind: 'blank-result', result });
      this.sink?.('blank', { at, result });
    }
    return this.engine.log.at(-1);
  }

  runAll(cues) {
    for (const cue of [...cues].sort((a, b) => a.at - b.at)) this.step(cue);
    return this.buildRecord(cues);
  }

  buildRecord(cues) {
    return {
      runId: this.engine.runId,
      branchOf: this.engine.branchOf,
      version: this.engine.doc.version,
      revision: this.engine.doc.revision,
      cues,
      engineLog: this.engine.log,
      scheduler: buildSchedulerDump(this.scheduler),
      timeline: this.timeline,
      finalState: this.engine.snapshot(),
    };
  }

  async save(dir) {
    await mkdir(dir, { recursive: true });
    const file = `${dir}/${this.engine.runId}.json`;
    await writeFile(file, JSON.stringify(this.buildRecord(this.engine.doc.cues), null, 2), 'utf8');
    return file;
  }
}

function buildSchedulerDump(scheduler) {
  const out = {};
  for (const [deviceId, screen] of scheduler.screens) {
    out[deviceId] = {
      history: screen.history,
      dropped: screen.dropped,
      finalFrame: screen.frame ? { frameId: screen.frame.frameId, text: screen.frame.text } : null,
    };
  }
  return out;
}

/** 舞监复查报告：每块屏幕在何时显示了什么、为何等待/跳过。 */
export function reviewReport(record) {
  const lines = [];
  lines.push(`排练 ${record.runId}${record.branchOf ? `（分支自 ${record.branchOf}）` : ''}`);
  lines.push(`稿本 ${record.version} r${record.revision}`);
  lines.push('');
  for (const [deviceId, dump] of Object.entries(record.scheduler)) {
    lines.push(`== 屏幕 ${deviceId} ==`);
    if (dump.history.length === 0) {
      lines.push('  （全程无画面播出）');
    }
    for (const h of dump.history) {
      const hold = h.clearedAt ? h.clearedAt - h.shownAt : null;
      lines.push(
        `  @${h.shownAt}ms 上屏 ${h.frameId}  停留≥${h.minHoldMs}ms` +
        (hold !== null ? ` 实际停留${hold}ms` : ' （至记录结束）'));
      for (const l of h.lines) lines.push(`    | ${l}`);
    }
    for (const d of dump.dropped) {
      lines.push(`  @${d.at}ms 未播出 ${d.frameId}：${d.reason}`);
    }
    lines.push('');
  }
  lines.push('== 引擎事件（位置识别 / 跳段 / 返场 / 稿本） ==');
  for (const ev of record.engineLog) {
    lines.push(`  #${ev.seq} ${formatEvent(ev)}`);
  }
  return lines.join('\n');
}

function formatEvent(ev) {
  switch (ev.type) {
    case 'line-confirmed':
      return `确认 ${ev.lineId}#${ev.occurrenceNo}（${ev.scene}/${ev.speaker}）听到“${ev.heard}”${ev.shortForm ? ` 短句=${ev.shortForm}` : ''}`;
    case 'heard-ambiguous':
      return `歧义“${ev.heard}” 候选=[${ev.candidates.join(', ')}] 可播交集=${ev.displayable.size ? '有' : '无（保持旧画面/空屏）'}`;
    case 'heard-unmatched':
      return `无法定位“${ev.heard}”，前沿=[${ev.frontier.join(', ')}]，等待人工`;
    case 'section-skipped':
      return `跳段 ${ev.sectionId}，封边=[${ev.blockedEdges.join(', ')}]`;
    case 'branch-taken':
      return `走向 ${ev.owner} -> ${ev.lineId}`;
    case 'encore':
      return `返场 ${ev.lineId}（第 ${ev.nextOccurrence} 次）`;
    case 'publish':
      return `发布 ${ev.frames.map((f) => `${f.deviceId}:${f.pages.length}帧${f.blocked.length ? ` 拦截${f.blocked.length}` : ''}`).join(' / ')}`;
    case 'shortform-blocked':
      return `未审短句被拦：“${ev.heard}”（${ev.lineId}）`;
    case 'director-unknown':
      return `舞监提示无法解析：“${ev.text}”（${ev.reason ?? ''}）`;
    case 'revision-check':
      return ev.safe ? `稿本切换检查通过 -> r${ev.newRevision}` : `稿本切换不安全，保留旧稿：缺台词=${ev.missingLines.length} 缺译文=${ev.missingTranslations.length} 语义漂移=${ev.changedMeanings.length}`;
    default:
      return JSON.stringify(ev);
  }
}

/** 从历史记录的任意事件序号开出练习分支，重放时仍走同一时间线与停留限制。 */
export function replayFromRecord(record, doc, atSeq, newRunId) {
  const engine = new Engine(doc, { runId: newRunId, branchOf: record.runId });
  const runner = new Runner(doc, { runId: newRunId, branchOf: record.runId });
  runner.engine = engine;
  // 重放 seq 之前的引擎事件，重建状态
  for (const ev of record.engineLog) {
    if (ev.seq > atSeq) break;
    replayEvent(engine, ev);
  }
  return runner;
}

function replayEvent(engine, ev) {
  switch (ev.type) {
    case 'line-confirmed':
      engine.confirmOccurrence(
        { lineId: ev.lineId, occurrenceNo: ev.occurrenceNo, scene: ev.scene, speaker: ev.speaker },
        ev.heard, ev.at);
      break;
    case 'section-skipped':
      engine.applySkip(ev.sectionId, ev.at);
      break;
    case 'branch-taken':
      engine.applyTake(ev.lineId, ev.at);
      break;
    case 'encore':
      engine.applyEncore(ev.lineId, ev.at);
      break;
    case 'goto':
      engine.applyGoto(ev.lineId, ev.at);
      break;
    default:
      break;
  }
}

export async function listRuns(dir) {
  const files = await readdir(dir).catch(() => []);
  return files.filter((f) => f.endsWith('.json')).sort();
}

export async function loadRun(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

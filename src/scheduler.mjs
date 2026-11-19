// 上屏调度：把引擎发布的分页帧按设备 minHoldMs 排队，
// 防止“快速切换妨碍阅读”；空屏指令也要等当前帧满足最短停留。
// 时间由外部 cue 的 at 推进（虚拟时钟），ingest 前先 drain 到期帧。
export class Scheduler {
  constructor(doc) {
    this.devices = new Map(doc.devices.map((d) => [d.id, d]));
    this.queues = new Map(doc.devices.map((d) => [d.id, []]));
    this.screens = new Map(doc.devices.map((d) => [d.id, blankScreen(d.id)]));
    this.now = 0;
  }

  /** 接收一次引擎 publish 事件；先把到点的旧帧放完，再追加新帧排队。 */
  ingest(publishEvent, at) {
    this.drainUntil(at);
    const force = publishEvent.reason === 'encore';
    const staleKeys = new Set((publishEvent.stale ?? []).map((s) => `${s.deviceId}|${s.itemKey}`));
    for (const deviceFrame of publishEvent.frames ?? []) {
      const queue = this.queues.get(deviceFrame.deviceId);
      const screen = this.screens.get(deviceFrame.deviceId);
      const onScreen = screen.frame?.frameId ?? null;
      const incoming = new Set(deviceFrame.pages.map((p) => p.frameId));

      if (force) {
        // 返场：旧排队全部作废，强制重排本次内容
        for (const f of queue.splice(0)) this.recordDrop(deviceFrame.deviceId, f, at, '返场重排');
      } else {
        // 常规发布：仅丢弃被引擎宣告失效（跳段/走向变更）的排队帧
        for (let i = queue.length - 1; i >= 0; i--) {
          if (staleKeys.has(`${deviceFrame.deviceId}|${queue[i].itemKey}`)) {
            const [f] = queue.splice(i, 1);
            this.recordDrop(deviceFrame.deviceId, f, at, '跳段/走向变更使帧失效');
          }
        }
      }
      // 在屏但已失效的帧：登记到最短停留后撤屏（防泄露且不违反可读停留）
      if (screen.frame && staleKeys.has(`${deviceFrame.deviceId}|${screen.frame.itemKey}`)) {
        screen.pendingBlank = true;
        screen.staleReason = `${screen.frame.itemKey} 已失效（跳段/走向变更）`;
      }
      for (const page of deviceFrame.pages) {
        // 已在屏/已排队的帧不重复排队；返场强制重排
        if (!force && (page.frameId === onScreen || queue.some((f) => f.frameId === page.frameId))) continue;
        queue.push({ ...page, enqueuedAt: at, blockedReasons: deviceFrame.blocked });
      }
    }
    return this.tick(at);
  }

  /** 推进虚拟时间，依次释放所有“到点”的帧（每帧至少停留 minHoldMs）。 */
  drainUntil(at) {
    const updates = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const [deviceId, device] of this.devices) {
        const screen = this.screens.get(deviceId);
        const queue = this.queues.get(deviceId);
        if (!screen.frame) {
          // 空屏状态下也要让待清标记结束，并继续接新帧
          if (screen.pendingBlank) {
            screen.pendingBlank = false;
            changed = true;
          }
          if (queue.length === 0) continue;
          updates.push(...this.releaseHead(deviceId, queue, at));
          changed = true;
          continue;
        }
        const dueAt = screen.shownAt + device.minHoldMs;
        if (dueAt > at) continue;
        if (screen.pendingBlank) {
          this.clearDevice(deviceId, dueAt, screen.staleReason ?? 'pending-blank');
          updates.push({ deviceId, at: dueAt, blanked: true });
          changed = true;
          continue;
        }
        if (queue.length === 0) continue;
        updates.push(...this.releaseHead(deviceId, queue, dueAt));
        changed = true;
      }
    }
    this.now = at;
    return updates;
  }

  releaseHead(deviceId, queue, at) {
    const screen = this.screens.get(deviceId);
    const device = this.devices.get(deviceId);
    const next = queue.shift();
    screen.frame = next;
    screen.shownAt = at;
    screen.pendingBlank = false;
    screen.history.push({
      frameId: next.frameId,
      itemKey: next.itemKey,
      text: next.text,
      lines: next.lines,
      shownAt: at,
      minHoldMs: device.minHoldMs,
    });
    return [{ deviceId, at, frame: next }];
  }

  /** 兼容实时模式：在给定时刻做一次释放检查。 */
  tick(at) {
    return this.drainUntil(at);
  }

  /**
   * 空屏：逐设备处理，仍受各自最短停留约束。
   * 已到点的立即清空；未到点的登记待清，由后续 drain 在到点时完成。
   */
  requestBlank(at, reason = 'manual') {
    this.drainUntil(at);
    const pending = [];
    for (const [deviceId, device] of this.devices) {
      const screen = this.screens.get(deviceId);
      const ready = !screen.frame || at - screen.shownAt >= device.minHoldMs;
      if (ready) {
        this.clearDevice(deviceId, at, reason);
      } else {
        screen.pendingBlank = true;
        pending.push({ deviceId, eligibleAt: screen.shownAt + device.minHoldMs });
      }
    }
    return { blanked: pending.length === 0, at, reason, pending };
  }

  clearDevice(deviceId, at, reason) {
    const screen = this.screens.get(deviceId);
    const dropped = this.queues.get(deviceId).splice(0);
    for (const f of dropped) this.recordDrop(deviceId, f, at, '清屏丢弃排队帧');
    if (screen.frame && screen.history.at(-1)) screen.history.at(-1).clearedAt = at;
    screen.frame = null;
    screen.shownAt = null;
    screen.pendingBlank = false;
    screen.lastBlankReason = reason;
  }

  recordDrop(deviceId, frame, at, reason) {
    const screen = this.screens.get(deviceId);
    screen.dropped.push({ frameId: frame.frameId, text: frame.text, at, reason });
  }

  screenState(deviceId) {
    const screen = this.screens.get(deviceId);
    const device = this.devices.get(deviceId);
    return {
      deviceId,
      frame: screen.frame,
      shownAt: screen.shownAt,
      minHoldMs: device.minHoldMs,
      pendingBlank: screen.pendingBlank,
      queueLength: this.queues.get(deviceId).length,
    };
  }

  allScreens() {
    return [...this.devices.keys()].map((id) => this.screenState(id));
  }
}

function blankScreen(deviceId) {
  return { deviceId, frame: null, shownAt: null, pendingBlank: false, history: [], dropped: [] };
}

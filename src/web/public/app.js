// 控制台逻辑：SSE 状态渲染 + 提示录入 + 歧义人工裁决 + 稿本切换。
const $ = (sel) => document.querySelector(sel);
let state = null;

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  if (!state) return;
  $('#runId').textContent = `排练 ${state.runId}`;

  // 前沿
  $('#frontier').innerHTML = state.engine.frontier.length
    ? state.engine.frontier.map((id) => {
        const line = lineById(id);
        return `<span class="chip ${state.engine.ended ? 'end' : ''}">${esc(id)} · ${esc(line?.scene ?? '')} · ${esc(line?.speaker ?? '')}：${esc(line?.text ?? '')}</span>`;
      }).join('')
    : '<span class="chip end">本场结束（前沿为空）</span>';

  $('#spoken').innerHTML = state.engine.spoken
    .map((o) => `<li>${esc(o.lineId)}#${o.occurrenceNo} @${o.at}ms “${esc(o.heard)}”${o.shortForm ? ` <span class="chip">短句</span>` : ''}</li>`)
    .join('');

  // 歧义
  const amb = state.engine.ambiguity;
  $('#ambiguityPanel').hidden = !amb;
  if (amb) {
    $('#ambHeard').textContent = amb.heard;
    $('#ambCandidates').innerHTML = amb.candidates.map((c) => `
      <div class="amb-card">
        <div><b>${esc(c.lineId)}</b>（第 ${c.occurrenceNo} 次）· ${esc(c.scene)} · ${esc(c.speaker)}</div>
        <div class="hint">${esc(lineById(c.lineId)?.text ?? '')}</div>
        <button onclick="resolve('${esc(c.lineId)}')">确认当前在此句</button>
      </div>`).join('');
  }

  // 投屏预览
  $('#screens').innerHTML = state.screens.map((s) => {
    const device = state.devices.find((d) => d.id === s.deviceId);
    return `<div class="screen-card">
      <div><b>${esc(s.deviceId)}</b> · ${esc(device.language)} · ${device.columns}码点×${device.lines}行 · 最短停留${device.minHoldMs}ms · 排队${s.queueLength}</div>
      <div class="stage">${s.frame ? s.frame.lines.map((l) => `<div class="sline">${esc(l)}</div>`).join('') : '<div class="sline blank">（空屏）</div>'}</div>
      <div class="hint">${s.frame ? `当前帧 ${s.frame.frameId}（第 ${s.frame.pageIndex + 1}/${s.frame.pageCount} 页）` : '无帧'}</div>
    </div>`;
  }).join('');

  // 日志
  $('#log').textContent = state.recentLog.map((e) => `#${e.seq} ${JSON.stringify(e)}`).join('\n');
}

function lineById(id) {
  // 剧本原文不在快照里时仅显示 id
  return window.__lines?.[id] ?? null;
}

window.resolve = async (lineId) => {
  await post('/api/resolve', { lineId });
};

$('#cueForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await post('/api/cue', {
    kind: fd.get('kind'),
    text: fd.get('text'),
    speaker: fd.get('speaker') || null,
  });
  e.target.reset();
});

$('#blankBtn').addEventListener('click', async () => {
  const r = await post('/api/blank', {});
  if (!r.blanked) alert(`仍有屏幕未满足最短停留，最早可清屏时间：${r.due?.map((d) => `${d.deviceId}@${d.eligibleAt}ms`).join(', ')}`);
});

$('#tickBtn').addEventListener('click', async () => {
  state = await post('/api/tick', {});
  render();
});

$('#revisionBtn').addEventListener('click', async () => {
  const json = $('#revisionJson').value;
  const r = await post('/api/revision', { json });
  const el = $('#revisionResult');
  if (r.safe) {
    el.innerHTML = '<span class="ok">切换通过，已采用新稿</span>';
  } else {
    el.innerHTML = `<span class="bad">拒绝切换，保留当前安全稿本</span>：${esc(r.error ?? JSON.stringify(r.note))}`;
  }
});

const es = new EventSource('/api/events');
es.onmessage = (e) => {
  state = JSON.parse(e.data);
  render();
};
// 拉取剧本原文用于前端展示
fetch('/api/state').then((r) => r.json()).then((s) => { state = s; render(); });

// 本地字幕工作台服务：控制台 + 每设备投屏页，SSE 实时推送，零第三方依赖。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadDocument, buildDocument } from '../document.mjs';
import { Runner } from '../rehearsal.mjs';

const WEB_DIR = fileURLToPath(new URL('./public', import.meta.url));

export class DeskServer {
  constructor(doc, { clock = () => Date.now() } = {}) {
    this.doc = doc;
    this.clock = clock;
    this.runner = new Runner(doc, { runId: `live-${Date.now()}`, sink: (kind, payload) => this.broadcast(kind, payload) });
    this.clients = new Map(); // res -> role
    this.server = createServer((req, res) => this.handle(req, res));
  }

  listen(port) {
    return new Promise((resolve) => this.server.listen(port, resolve));
  }

  broadcast(kind, payload) {
    const data = `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.clients.keys()) {
      try { res.write(`data: ${JSON.stringify(this.state())}\n\n`); res.write(data); }
      catch { /* 客户端断开由 close 事件清理 */ }
    }
  }

  state() {
    return {
      runId: this.runner.engine.runId,
      devices: this.doc.devices,
      screens: this.runner.scheduler.allScreens(),
      engine: this.runner.engine.snapshot(),
      recentLog: this.runner.engine.log.slice(-12),
    };
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/state') return this.json(res, this.state());
      if (url.pathname === '/api/events') return this.openSse(req, res);
      if (req.method === 'POST' && url.pathname === '/api/cue') {
        const body = await readBody(req);
        return this.json(res, this.acceptCue(body));
      }
      if (req.method === 'POST' && url.pathname === '/api/resolve') {
        const body = await readBody(req);
        const at = this.clock();
        this.runner.engine.resolveAmbiguity(body.lineId, { at });
        const ev = this.runner.engine.log.at(-1);
        if (ev?.type === 'publish') {
          this.runner.scheduler.ingest(ev, at);
          this.runner.scheduler.tick(at);
        }
        this.broadcast('state', this.state());
        return this.json(res, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/blank') {
        const at = this.clock();
        const result = this.runner.scheduler.requestBlank(at, 'operator');
        this.runner.engine.record('operator-blank', { at, result });
        this.broadcast('state', this.state());
        return this.json(res, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/shortform') {
        const body = await readBody(req);
        const at = this.clock();
        const ev = this.runner.engine.requestShortForm(body.lineId, body.heard, { at });
        if (ev?.type === 'publish') {
          this.runner.scheduler.ingest(ev, at);
          this.runner.scheduler.tick(at);
        }
        this.broadcast('state', this.state());
        return this.json(res, { ok: true, event: ev.type });
      }
      if (req.method === 'POST' && url.pathname === '/api/revision') {
        const body = await readBody(req);
        let newDoc;
        try { newDoc = buildDocument(JSON.parse(body.json)); }
        catch (err) { return this.json(res, { safe: false, error: err.message }, 400); }
        const result = this.runner.engine.switchRevision(newDoc, { at: this.clock() });
        if (result.safe) {
          this.doc = newDoc;
          const ev = this.runner.engine.log.at(-1);
          if (ev?.type === 'publish') this.runner.scheduler.ingest(ev, this.clock());
        }
        this.broadcast('state', this.state());
        return this.json(res, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/tick') {
        this.runner.scheduler.tick(this.clock());
        return this.json(res, this.state());
      }
      return this.static(url.pathname, res);
    } catch (err) {
      this.json(res, { error: err.message }, 500);
    }
  }

  acceptCue(body) {
    // 实时工作台默认用墙钟毫秒；显式 at 仅用于离线/演示
    const at = Number.isFinite(body.at) ? body.at : this.clock();
    const cue = { at, kind: body.kind, text: body.text, speaker: body.speaker, op: body.op, target: body.target };
    const ev = this.runner.step(cue);
    this.broadcast('state', this.state());
    return { ok: true, event: ev?.type ?? null, at };
  }

  openSse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(this.state())}\n\n`);
    this.clients.set(res, req.url);
    req.on('close', () => this.clients.delete(res));
  }

  json(res, obj, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  async static(pathname, res) {
    const name = pathname === '/' ? '/operator.html' : pathname;
    const type = name.endsWith('.html') ? 'text/html; charset=utf-8'
      : name.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    try {
      const content = await readFile(`${WEB_DIR}${name}`);
      res.writeHead(200, { 'Content-Type': type });
      res.end(content);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export async function startFromFile(file, port) {
  const doc = await loadDocument(file);
  const server = new DeskServer(doc);
  await server.listen(port);
  return server;
}

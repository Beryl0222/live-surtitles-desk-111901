#!/usr/bin/env node
// 启动本地工作台：node cli/serve.mjs <show.json> [端口]
import { startFromFile } from '../src/web/server.mjs';

const [showFile = 'data/sample-show.json', portText = '4173'] = process.argv.slice(2);
const port = Number(portText);
await startFromFile(showFile, port);
console.log(`字幕工作台已启动: http://localhost:${port}`);
console.log(`  控制台:    http://localhost:${port}/`);
console.log(`  中文投屏:  http://localhost:${port}/screen.html?device=side-zh`);
console.log(`  英文投屏:  http://localhost:${port}/screen.html?device=side-en`);

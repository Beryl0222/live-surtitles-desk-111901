#!/usr/bin/env node
// 用法: node cli/review.mjs <run-record.json>
// 输出舞监复查报告：每块屏幕何时显示了什么、为何等待或跳过。
import { loadRun } from '../src/rehearsal.mjs';
import { reviewReport } from '../src/rehearsal.mjs';

const file = process.argv[2];
if (!file) {
  console.error('用法: node cli/review.mjs <run-record.json>');
  process.exit(1);
}
const record = await loadRun(file);
console.log(reviewReport(record));

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function quantile(arr, q) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function stats(rows) {
  const chars = rows.map((r) => Number(r.promptChars || 0)).filter((n) => Number.isFinite(n) && n > 0);
  if (!chars.length) return { samples: 0, p50: 0, p90: 0, avg: 0, max: 0 };
  const sum = chars.reduce((a, b) => a + b, 0);
  return {
    samples: chars.length,
    p50: Math.round(quantile(chars, 0.5)),
    p90: Math.round(quantile(chars, 0.9)),
    avg: Math.round(sum / chars.length),
    max: Math.max(...chars),
  };
}

function main() {
  const logPath = process.argv[2] || path.join(process.cwd(), 'agent-metrics.log');
  const raw = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const rows = raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  const overall = stats(rows);
  const byRoom = {};
  const bySourceType = {};

  for (const row of rows) {
    const room = row.roomId || 'unknown';
    const sourceType = row.route?.sourceType || 'unknown';
    byRoom[room] = byRoom[room] || [];
    byRoom[room].push(row);
    bySourceType[sourceType] = bySourceType[sourceType] || [];
    bySourceType[sourceType].push(row);
  }

  const roomStats = Object.fromEntries(Object.entries(byRoom).map(([k, v]) => [k, stats(v)]));
  const sourceStats = Object.fromEntries(Object.entries(bySourceType).map(([k, v]) => [k, stats(v)]));

  const report = {
    logPath,
    overall,
    byRoom: roomStats,
    byRouteSourceType: sourceStats,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();

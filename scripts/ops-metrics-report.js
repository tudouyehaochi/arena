#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const metricsFile = process.argv[2] || path.join(process.cwd(), 'agent-metrics.log');

function parseLines(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}

function dayKey(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

function summarize(rows) {
  const byDay = {};
  for (const row of rows) {
    const day = dayKey(row.ts);
    if (!byDay[day]) {
      byDay[day] = {
        invokes: 0,
        avgPromptChars: 0,
        totalPromptChars: 0,
        avgActiveRoles: 0,
        totalActiveRoles: 0,
        avgRetrievalCount: 0,
        totalRetrievalCount: 0,
        droppedRoles: 0,
        circuitOpenCount: 0,
        maxDegradeLevel: 0,
      };
    }
    const d = byDay[day];
    d.invokes += 1;
    d.totalPromptChars += Number(row.promptChars || 0);
    const activeRoles = Array.isArray(row.activeRoles) ? row.activeRoles.length : 0;
    d.totalActiveRoles += activeRoles;
    d.totalRetrievalCount += Number(row.retrievalCount || 0);
    d.droppedRoles += Number(row.droppedRoles || 0);
    if (row.circuitOpen) d.circuitOpenCount += 1;
    d.maxDegradeLevel = Math.max(d.maxDegradeLevel, Number(row.degradeLevel || 0));
  }

  for (const day of Object.keys(byDay)) {
    const d = byDay[day];
    d.avgPromptChars = Math.round(d.totalPromptChars / Math.max(1, d.invokes));
    d.avgActiveRoles = Number((d.totalActiveRoles / Math.max(1, d.invokes)).toFixed(2));
    d.avgRetrievalCount = Number((d.totalRetrievalCount / Math.max(1, d.invokes)).toFixed(2));
  }

  return byDay;
}

const rows = parseLines(metricsFile);
const report = {
  file: metricsFile,
  rows: rows.length,
  daily: summarize(rows),
};

console.log(JSON.stringify(report, null, 2));

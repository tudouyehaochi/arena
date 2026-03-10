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
  const byWeek = {};
  function weekKey(day) {
    if (day === 'unknown') return 'unknown';
    return day.slice(0, 7);
  }
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
    const wk = weekKey(day);
    if (!byWeek[wk]) {
      byWeek[wk] = {
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
    const w = byWeek[wk];
    d.invokes += 1;
    w.invokes += 1;
    d.totalPromptChars += Number(row.promptChars || 0);
    w.totalPromptChars += Number(row.promptChars || 0);
    const activeRoles = Array.isArray(row.activeRoles) ? row.activeRoles.length : 0;
    d.totalActiveRoles += activeRoles;
    w.totalActiveRoles += activeRoles;
    d.totalRetrievalCount += Number(row.retrievalCount || 0);
    w.totalRetrievalCount += Number(row.retrievalCount || 0);
    d.droppedRoles += Number(row.droppedRoles || 0);
    w.droppedRoles += Number(row.droppedRoles || 0);
    if (row.circuitOpen) d.circuitOpenCount += 1;
    if (row.circuitOpen) w.circuitOpenCount += 1;
    d.maxDegradeLevel = Math.max(d.maxDegradeLevel, Number(row.degradeLevel || 0));
    w.maxDegradeLevel = Math.max(w.maxDegradeLevel, Number(row.degradeLevel || 0));
  }

  for (const day of Object.keys(byDay)) {
    const d = byDay[day];
    d.avgPromptChars = Math.round(d.totalPromptChars / Math.max(1, d.invokes));
    d.avgActiveRoles = Number((d.totalActiveRoles / Math.max(1, d.invokes)).toFixed(2));
    d.avgRetrievalCount = Number((d.totalRetrievalCount / Math.max(1, d.invokes)).toFixed(2));
  }
  for (const week of Object.keys(byWeek)) {
    const w = byWeek[week];
    w.avgPromptChars = Math.round(w.totalPromptChars / Math.max(1, w.invokes));
    w.avgActiveRoles = Number((w.totalActiveRoles / Math.max(1, w.invokes)).toFixed(2));
    w.avgRetrievalCount = Number((w.totalRetrievalCount / Math.max(1, w.invokes)).toFixed(2));
  }

  return { byDay, byWeek };
}

const rows = parseLines(metricsFile);
const report = {
  file: metricsFile,
  rows: rows.length,
  aggregates: summarize(rows),
};

console.log(JSON.stringify(report, null, 2));

#!/usr/bin/env node
const fs = require('fs');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const currentPath = process.argv[2];
  const baselinePath = process.argv[3];
  const thresholdPct = Number(process.argv[4] || '10');

  if (!currentPath || !baselinePath) {
    console.error('Usage: node scripts/prompt-regression-check.js <current.json> <baseline.json> [thresholdPct]');
    process.exit(2);
  }

  const current = readJson(currentPath);
  const baseline = readJson(baselinePath);
  const currP90 = Number(current?.overall?.p90 || 0);
  const baseP90 = Number(baseline?.overall?.p90 || 0);

  if (currP90 <= 0 || baseP90 <= 0) {
    console.error('Invalid p90 values in report files');
    process.exit(2);
  }

  const deltaPct = ((currP90 - baseP90) / baseP90) * 100;
  const payload = {
    baselineP90: baseP90,
    currentP90: currP90,
    deltaPct: Math.round(deltaPct * 100) / 100,
    thresholdPct,
  };

  if (deltaPct > thresholdPct) {
    console.error(`prompt regression detected: ${JSON.stringify(payload)}`);
    process.exit(1);
  }

  console.log(`prompt regression check passed: ${JSON.stringify(payload)}`);
}

main();

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('../lib/intel-scheduler');

describe('intel-scheduler', () => {
  it('parses cron hour/minute', () => {
    const out = scheduler.parseCronHM('15 8 * * *');
    assert.equal(out.minute, 15);
    assert.equal(out.hour, 8);
  });

  it('shouldRunNow checks local day in timezone', () => {
    const config = scheduler.normalizeConfig({
      enabled: true,
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
    });
    const now = new Date('2026-03-11T01:00:00.000Z'); // 09:00 Asia/Shanghai
    const due = scheduler.shouldRunNow(config, { lastDayKey: '2026-03-10' }, now);
    assert.equal(due, true);
    const skipped = scheduler.shouldRunNow(config, { lastDayKey: '2026-03-11' }, now);
    assert.equal(skipped, false);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../lib/ai-intel-pipeline');

function fakeFetchFactory(map) {
  return async (url) => {
    const payload = map[url];
    if (!payload) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => payload };
  };
}

describe('ai-intel-pipeline', () => {
  it('dedupes items by url and preserves unique entries', () => {
    const input = [
      { title: 'A', url: 'https://example.com/a', summary: 'a' },
      { title: 'A dup', url: 'https://example.com/a', summary: 'a2' },
      { title: 'B', url: '', summary: 'b' },
      { title: 'B', url: '', summary: 'b' },
    ];
    const out = pipeline.dedupeItems(input);
    assert.equal(out.length, 2);
  });

  it('runs daily ingest with whitelist, tagging and skip-once-per-day', async () => {
    const roomId = `intel_${Date.now()}`;
    const source = 'https://news.example.com/feed.json';
    const fetchImpl = fakeFetchFactory({
      [source]: {
        items: [
          {
            title: 'OpenAI release',
            summary: 'OpenAI announce new model release',
            url: 'https://news.example.com/openai-release',
            publishedAt: '2026-03-10T08:00:00Z',
          },
          {
            title: 'OpenAI release duplicate',
            summary: 'OpenAI announce new model release',
            url: 'https://news.example.com/openai-release',
            publishedAt: '2026-03-10T08:01:00Z',
          },
        ],
      },
    });
    const report = await pipeline.runDailyIntelIngest({
      roomId,
      sources: [source],
      whitelistDomains: ['example.com'],
      fetchImpl,
      now: Date.parse('2026-03-10T09:00:00Z'),
      force: false,
    });
    assert.equal(report.sourceCount, 1);
    assert.equal(report.fetchedCount, 2);
    assert.equal(report.dedupedCount, 1);
    assert.equal(report.storedCount, 1);

    const skipped = await pipeline.runDailyIntelIngest({
      roomId,
      sources: [source],
      whitelistDomains: ['example.com'],
      fetchImpl,
      now: Date.parse('2026-03-10T12:00:00Z'),
      force: false,
    });
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, 'already_ran_today');
  });
});

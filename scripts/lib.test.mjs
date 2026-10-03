import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendSample, checkTarget, parseTargets, summarize } from './lib.mjs';

const target = { id: 'a', name: 'A', url: 'https://example.com/', expectStatus: 200 };

describe('parseTargets', () => {
  it('accepts valid targets and defaults expectStatus', () => {
    const [t] = parseTargets([{ id: 'a', name: 'A', url: 'https://example.com' }]);
    assert.equal(t.expectStatus, 200);
    assert.equal(t.url, 'https://example.com/');
  });

  it('rejects empty, malformed, non-http and duplicate targets', () => {
    assert.throws(() => parseTargets([]), /non-empty/);
    assert.throws(() => parseTargets([{ id: 'a' }]), /needs string/);
    assert.throws(() => parseTargets([{ id: 'a', name: 'A', url: 'ftp://x' }]), /http/);
    assert.throws(() => parseTargets([target, target]), /duplicate/);
  });
});

describe('checkTarget', () => {
  const clock = () => {
    let t = 0;
    return () => (t += 50);
  };

  it('reports up when the status matches', async () => {
    const r = await checkTarget(target, {
      fetchImpl: async () => new Response('ok', { status: 200 }),
      now: clock(),
    });
    assert.deepEqual(r, { id: 'a', ok: true, status: 200, ms: 50 });
  });

  it('reports down on an unexpected status', async () => {
    const r = await checkTarget(target, {
      fetchImpl: async () => new Response('', { status: 503 }),
      now: clock(),
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'HTTP 503');
  });

  it('reports down on network errors', async () => {
    const r = await checkTarget(target, {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
      now: clock(),
    });
    assert.equal(r.status, 0);
    assert.equal(r.error, 'ECONNREFUSED');
  });
});

describe('history', () => {
  const sample = (t, ok, ms = 100) => ({ t, results: [{ id: 'a', ok, status: ok ? 200 : 0, ms }] });

  it('drops samples outside the retention window', () => {
    const h = appendSample([sample('2026-01-01T00:00:00Z', true)], sample('2026-01-02T00:00:00Z', true), 60_000);
    assert.equal(h.length, 1);
    assert.equal(h[0].t, '2026-01-02T00:00:00Z');
  });

  it('summarizes uptime and latency over a window', () => {
    const now = Date.parse('2026-01-01T01:00:00Z');
    const h = [
      sample('2025-12-31T00:00:00Z', false),
      sample('2026-01-01T00:10:00Z', true, 100),
      sample('2026-01-01T00:20:00Z', true, 300),
      sample('2026-01-01T00:30:00Z', false),
      sample('2026-01-01T00:40:00Z', true, 200),
    ];
    assert.deepEqual(summarize(h, 'a', 3_600_000, now), { checks: 4, uptime: 75, avgMs: 200 });
    assert.deepEqual(summarize(h, 'missing', 3_600_000, now), { checks: 0, uptime: null, avgMs: null });
  });
});

/** Keep 7 days of history (~2k samples at a 5-minute cadence) to bound the data branch. */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @typedef {{ id: string, name: string, url: string, expectStatus?: number }} Target
 * @typedef {{ id: string, ok: boolean, status: number, ms: number, error?: string }} CheckResult
 * @typedef {{ t: string, results: CheckResult[] }} Sample
 */

/**
 * Validates targets.json so a typo fails loudly instead of silently skipping checks.
 * @param {unknown} raw
 * @returns {Target[]}
 */
export function parseTargets(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('targets.json must be a non-empty array');
  }
  const ids = new Set();
  return raw.map((t, i) => {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.url !== 'string') {
      throw new Error(`target ${i} needs string id, name and url`);
    }
    const url = new URL(t.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`target ${t.id} must use http(s)`);
    }
    if (ids.has(t.id)) throw new Error(`duplicate target id ${t.id}`);
    ids.add(t.id);
    return { id: t.id, name: t.name, url: url.toString(), expectStatus: t.expectStatus ?? 200 };
  });
}

/**
 * Performs one HTTP check with a timeout.
 * @param {Target} target
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number }} [opts]
 * @returns {Promise<CheckResult>}
 */
export async function checkTarget(target, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => performance.now());
  const start = now();
  try {
    const res = await fetchImpl(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { 'User-Agent': 'rolodex-status-monitor' },
    });
    const ms = Math.round(now() - start);
    const ok = res.status === (target.expectStatus ?? 200);
    return { id: target.id, ok, status: res.status, ms, ...(ok ? {} : { error: `HTTP ${res.status}` }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: target.id, ok: false, status: 0, ms: Math.round(now() - start), error: message };
  }
}

/**
 * Appends a sample and drops samples older than the retention window.
 * @param {Sample[]} history
 * @param {Sample} sample
 * @param {number} [retentionMs]
 * @returns {Sample[]}
 */
export function appendSample(history, sample, retentionMs = RETENTION_MS) {
  const cutoff = Date.parse(sample.t) - retentionMs;
  return [...history, sample].filter((s) => Date.parse(s.t) >= cutoff);
}

/**
 * Uptime percentage and average latency for one target over a time window.
 * @param {Sample[]} history
 * @param {string} id
 * @param {number} windowMs
 * @param {number} nowMs
 * @returns {{ checks: number, uptime: number | null, avgMs: number | null }}
 */
export function summarize(history, id, windowMs, nowMs) {
  const results = history
    .filter((s) => Date.parse(s.t) >= nowMs - windowMs)
    .flatMap((s) => s.results.filter((r) => r.id === id));
  if (results.length === 0) return { checks: 0, uptime: null, avgMs: null };
  const up = results.filter((r) => r.ok);
  const avgMs = up.length ? Math.round(up.reduce((a, r) => a + r.ms, 0) / up.length) : null;
  return { checks: results.length, uptime: (up.length / results.length) * 100, avgMs };
}

import { summarize } from '../scripts/lib.mjs';
import { fmtUptime, latencySvg } from './chart.mjs';

const REPO = 'Sun-Wukhan/rolodex-status';
// Served from the data branch via raw.githubusercontent.com (CORS-enabled), so
// new samples appear without rebuilding the Pages site.
const HISTORY_URL = `https://raw.githubusercontent.com/${REPO}/data/history.json`;
const REFRESH_MS = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const LIVE_KEY = 'rolodex-status-live';

/** @typedef {import('../scripts/lib.mjs').Target} Target */
/** @typedef {import('../scripts/lib.mjs').Sample} Sample */
/** @typedef {import('./chart.mjs').Point} Point */

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @returns {Record<string, Point[]>} */
function loadLive() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** @param {Record<string, Point[]>} live */
function saveLive(live) {
  const cutoff = Date.now() - DAY;
  for (const id of Object.keys(live)) live[id] = live[id].filter((p) => p.t >= cutoff);
  localStorage.setItem(LIVE_KEY, JSON.stringify(live));
}

/**
 * Probes a target from the browser. Cross-origin responses are opaque in
 * no-cors mode, so this measures reachability and latency, not status codes.
 * @param {Target} target
 * @returns {Promise<Point>}
 */
async function probe(target) {
  const start = performance.now();
  try {
    await fetch(target.url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    return { t: Date.now(), ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    return { t: Date.now(), ok: false, ms: 0 };
  }
}

/** @returns {Promise<Sample[]>} */
async function fetchHistory() {
  const res = await fetch(`${HISTORY_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`history unavailable (HTTP ${res.status})`);
  return res.json();
}

/**
 * @param {string} text
 */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * @param {Target} target
 * @param {Sample[]} history
 * @param {Point[]} live
 */
function renderTarget(target, history, live) {
  const now = Date.now();
  const recorded = history
    .map((s) => ({ s, r: s.results.find((r) => r.id === target.id) }))
    .filter((x) => x.r)
    .map(({ s, r }) => ({ t: Date.parse(s.t), ok: r.ok, ms: r.ms, status: r.status, error: r.error }));
  const last = recorded.at(-1);
  const lastLive = live.at(-1);
  const up = last ? last.ok : lastLive?.ok;
  const stateClass = up === undefined ? 'neutral' : up ? 'success' : 'danger';
  const stateText = up === undefined ? 'No data yet' : up ? 'Operational' : 'Down';

  const stats = [
    ['24h uptime', fmtUptime(summarize(history, target.id, DAY, now).uptime)],
    ['7d uptime', fmtUptime(summarize(history, target.id, 7 * DAY, now).uptime)],
    ['Checks (7d)', String(summarize(history, target.id, 7 * DAY, now).checks)],
    ['Avg response (24h)', (() => {
      const ms = summarize(history, target.id, DAY, now).avgMs;
      return ms === null ? '-' : `${ms} ms`;
    })()],
    ['Live probe', lastLive ? (lastLive.ok ? `${lastLive.ms} ms` : 'unreachable') : '-'],
  ];

  const strip = recorded.slice(-90).map((p) => {
    const label = `${new Date(p.t).toLocaleString()} - ${p.ok ? `${p.ms} ms` : escapeHtml(p.error ?? 'down')}`;
    return `<span class="tick ${p.ok ? 'ok' : 'bad'}" title="${label}"></span>`;
  }).join('');

  return `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>${escapeHtml(target.name)}</h2>
          <a class="url" href="${escapeHtml(target.url)}">${escapeHtml(target.url)}</a>
        </div>
        <span class="pill ${stateClass}">${stateText}</span>
      </div>
      <dl class="stats">
        ${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
      </dl>
      <div class="chart-head">
        <h3>Response time, last 24 hours</h3>
        <span class="legend"><i class="lg recorded"></i>Recorded (Actions) <i class="lg live"></i>Live (this browser) <i class="lg down"></i>Down</span>
      </div>
      <div class="chart">${latencySvg({ recorded, live, width: 900, height: 220, from: now - DAY, to: now })}</div>
      <h3>Last ${Math.min(recorded.length, 90)} recorded checks</h3>
      <div class="strip">${strip || '<span class="muted">Waiting for the first scheduled check…</span>'}</div>
      ${last ? `<p class="muted">Last recorded check ${new Date(last.t).toLocaleString()} · HTTP ${last.status || 'error'}</p>` : ''}
    </section>`;
}

/** Refreshes recorded history, runs live probes and re-renders. */
async function refresh() {
  try {
    const [targets, history] = await Promise.all([
      fetch('targets.json', { cache: 'no-store' }).then((r) => r.json()),
      fetchHistory(),
    ]);
    const live = loadLive();
    const probes = await Promise.all(targets.map(probe));
    targets.forEach((t, i) => (live[t.id] = [...(live[t.id] ?? []), probes[i]]));
    saveLive(live);

    $('targets').innerHTML = targets.map((t) => renderTarget(t, history, live[t.id] ?? [])).join('');
    const anyDown = $('targets').querySelector('.card-head .danger');
    const overall = $('overall');
    overall.className = `pill ${anyDown ? 'danger' : 'success'}`;
    overall.textContent = anyDown ? 'Partial outage' : 'All systems operational';
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    $('error').hidden = true;
  } catch (err) {
    $('error').hidden = false;
    $('error').textContent = `Could not refresh status: ${err instanceof Error ? err.message : err}`;
  }
}

let next = Date.now() + REFRESH_MS;
setInterval(() => {
  const left = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  $('countdown').textContent = String(left);
  if (left === 0) {
    next = Date.now() + REFRESH_MS;
    refresh();
  }
}, 1000);
refresh();

/**
 * Pure helpers for the status page, kept free of DOM access so they can be
 * unit tested with node:test.
 */

/**
 * @typedef {{ t: number, ok: boolean, ms: number }} Point
 */

/**
 * Builds an SVG latency chart. Successful checks form the line; failed checks
 * are drawn as red markers on the baseline so outages are visible at a glance.
 * @param {{ recorded: Point[], live: Point[], width: number, height: number, from: number, to: number }} args
 * @returns {string} SVG markup
 */
export function latencySvg({ recorded, live, width, height, from, to }) {
  const pad = { l: 44, r: 12, t: 12, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const all = [...recorded, ...live].filter((p) => p.ok);
  const maxMs = niceCeil(Math.max(100, ...all.map((p) => p.ms)));
  const x = (t) => pad.l + ((t - from) / Math.max(to - from, 1)) * w;
  const y = (ms) => pad.t + h - (ms / maxMs) * h;

  const grid = [0, 0.5, 1]
    .map((f) => {
      const ms = Math.round(maxMs * f);
      return `<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(ms)}" y2="${y(ms)}" class="grid"/>` +
        `<text x="${pad.l - 6}" y="${y(ms) + 4}" class="axis" text-anchor="end">${ms}ms</text>`;
    })
    .join('');

  const ticks = timeTicks(from, to, 4)
    .map((t) => `<text x="${x(t)}" y="${height - 6}" class="axis" text-anchor="middle">${fmtTime(t)}</text>`)
    .join('');

  const line = (pts, cls) => {
    const ok = pts.filter((p) => p.ok && p.t >= from);
    if (ok.length === 0) return '';
    const d = ok.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.ms).toFixed(1)}`).join('');
    return `<path d="${d}" class="${cls}"/>` +
      ok.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.ms).toFixed(1)}" r="2" class="${cls}-dot"/>`).join('');
  };

  const downs = [...recorded, ...live]
    .filter((p) => !p.ok && p.t >= from)
    .map((p) => `<rect x="${(x(p.t) - 2).toFixed(1)}" y="${pad.t}" width="4" height="${h}" class="down"/>`)
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Response time chart">` +
    `${grid}${ticks}${downs}${line(recorded, 'recorded')}${line(live, 'live')}</svg>`;
}

/**
 * Rounds up to a readable axis maximum (1, 2 or 5 times a power of ten).
 * @param {number} n
 */
export function niceCeil(n) {
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= n) ?? n;
}

/**
 * Evenly spaced timestamps between from and to (inclusive).
 * @param {number} from
 * @param {number} to
 * @param {number} count
 */
export function timeTicks(from, to, count) {
  return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
}

/** @param {number} t */
function fmtTime(t) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Formats an uptime percentage for display.
 * @param {number | null} pct
 */
export function fmtUptime(pct) {
  if (pct === null) return '-';
  return pct === 100 ? '100%' : `${pct.toFixed(2)}%`;
}

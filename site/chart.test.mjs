import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmtUptime, latencySvg, niceCeil, timeTicks } from './chart.mjs';

describe('chart helpers', () => {
  it('rounds axis maxima to readable values', () => {
    assert.equal(niceCeil(130), 200);
    assert.equal(niceCeil(480), 500);
    assert.equal(niceCeil(1000), 1000);
  });

  it('spaces ticks evenly', () => {
    assert.deepEqual(timeTicks(0, 100, 4), [0, 25, 50, 75, 100]);
  });

  it('formats uptime', () => {
    assert.equal(fmtUptime(null), '-');
    assert.equal(fmtUptime(100), '100%');
    assert.equal(fmtUptime(99.5), '99.50%');
  });

  it('draws lines for successful checks and markers for outages', () => {
    const svg = latencySvg({
      recorded: [
        { t: 10, ok: true, ms: 120 },
        { t: 20, ok: false, ms: 0 },
        { t: 30, ok: true, ms: 80 },
      ],
      live: [{ t: 40, ok: true, ms: 60 }],
      width: 400,
      height: 200,
      from: 0,
      to: 50,
    });
    assert.match(svg, /<path d="M[^"]+L[^"]+" class="recorded"\/>/);
    assert.match(svg, /class="live"/);
    assert.equal((svg.match(/class="down"/g) ?? []).length, 1);
    assert.match(svg, /200ms/);
  });

  it('renders an empty chart without data', () => {
    const svg = latencySvg({ recorded: [], live: [], width: 400, height: 200, from: 0, to: 50 });
    assert.doesNotMatch(svg, /<path/);
  });
});

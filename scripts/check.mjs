#!/usr/bin/env node
// Runs every configured health check once and appends the results to the
// history file. Usage: node scripts/check.mjs <targets.json> <history.json>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appendSample, checkTarget, parseTargets } from './lib.mjs';

const [targetsPath = 'targets.json', historyPath = 'data/history.json'] = process.argv.slice(2);

const targets = parseTargets(JSON.parse(await readFile(targetsPath, 'utf8')));

/** @type {import('./lib.mjs').Sample[]} */
let history = [];
try {
  history = JSON.parse(await readFile(historyPath, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const results = await Promise.all(targets.map((t) => checkTarget(t)));
const sample = { t: new Date().toISOString(), results };
history = appendSample(history, sample);

await mkdir(dirname(historyPath), { recursive: true });
await writeFile(historyPath, JSON.stringify(history));
await writeFile(
  `${dirname(historyPath)}/latest.json`,
  JSON.stringify({ ...sample, targets }, null, 2),
);

for (const r of results) {
  console.log(`${r.ok ? 'UP  ' : 'DOWN'} ${r.id} status=${r.status} ${r.ms}ms${r.error ? ` (${r.error})` : ''}`);
}

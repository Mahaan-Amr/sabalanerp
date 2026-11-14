#!/usr/bin/env node
// Read-only comparison of the #439 no-data probe's custody files.
import fs from 'node:fs';
import path from 'node:path';

const shared = [
  'initial-netns', 'initial-iptables-v4', 'initial-iptables-v6',
  'initial-routes-v4', 'initial-routes-v6', 'initial-links',
  'desktop-netns', 'desktop-docker-id', 'desktop-service-census',
  'local-service-census',
];

function read(root, name) {
  const file = path.join(root, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0 || stat.size > 1024 * 1024) {
    throw new Error(`invalid evidence: ${name}`);
  }
  return fs.readFileSync(file);
}

function namespace(bytes, name) {
  const value = bytes.toString('utf8').trim();
  if (!/^net:\[[1-9][0-9]*\]$/.test(value)) throw new Error(`invalid namespace: ${name}`);
  return value;
}

try {
  if (process.argv.length !== 3) throw new Error('usage: verify-qa-netns-evidence.mjs EVIDENCE_DIRECTORY');
  const root = fs.realpathSync(process.argv[2]);
  for (const name of shared) {
    const before = read(root, `${name}.before`);
    const after = read(root, `${name}.after`);
    if (!before.equals(after)) throw new Error(`shared state changed: ${name}`);
  }
  const initial = namespace(read(root, 'initial-netns.after'), 'initial');
  const desktop = namespace(read(root, 'desktop-netns.after'), 'Desktop');
  const qa = namespace(read(root, 'qa-netns.after'), 'QA');
  const daemon = namespace(read(root, 'qa-daemon-netns.after'), 'QA daemon');
  if (initial !== desktop || initial === qa || qa !== daemon) {
    throw new Error('namespace identity mismatch');
  }
  process.stdout.write(`PASS: shared snapshots unchanged; QA daemon in distinct ${qa}\n`);
} catch (error) {
  process.stderr.write(`REFUSE: ${error.message}\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node
// PROTOTYPE ONLY — terminal shell around the pure reconciliation model.

import readline from 'node:readline';
import { presentLedger } from './model.mjs';
import { runScenario, scenarios } from './scenarios.mjs';

const bold = (value) => `\x1b[1m${value}\x1b[0m`;
const dim = (value) => `\x1b[2m${value}\x1b[0m`;

const printScenario = (scenario) => {
  const result = runScenario(scenario);
  const final = result.snapshots.at(-1);
  console.log(`\n${bold(scenario.name)}`);
  console.log(JSON.stringify(presentLedger(final.ledger), null, 2));
  console.log(`${bold('Verdict:')} ${scenario.verdict}\n`);
};

if (process.argv.includes('--all')) {
  scenarios.forEach(printScenario);
  process.exit(0);
}

let selected = null;
let snapshotIndex = 0;

const render = () => {
  console.clear();
  console.log(bold('PROTOTYPE — Customer Shipment Statement reconciliation'));
  console.log(dim('Quantity scale: 3 · monetary allocation scale: 12 · presentation: nearest whole currency unit\n'));
  if (!selected) {
    console.log(bold('Scenarios'));
    scenarios.forEach((scenario) => console.log(`  [${scenario.key}] ${scenario.name}`));
  } else {
    const result = runScenario(selected);
    const snapshot = result.snapshots[snapshotIndex];
    console.log(`${bold(selected.name)} · ${snapshot.label} · ${snapshotIndex}/${result.snapshots.length - 1}\n`);
    console.log(JSON.stringify(presentLedger(snapshot.ledger), null, 2));
    console.log(`\n${bold('Expected verdict:')} ${selected.verdict}`);
  }
  console.log(`\n${bold('[1-9]')} scenario  ${bold('[n]')} next action  ${bold('[p]')} previous  ${bold('[r]')} menu  ${bold('[q]')} quit`);
};

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', (_text, key) => {
  if (key?.name === 'q' || (key?.ctrl && key?.name === 'c')) process.exit(0);
  if (key?.name === 'r') { selected = null; snapshotIndex = 0; }
  const scenario = scenarios.find((item) => item.key === key?.name);
  if (scenario) { selected = scenario; snapshotIndex = 0; }
  if (selected && key?.name === 'n') snapshotIndex = Math.min(snapshotIndex + 1, selected.steps.length);
  if (selected && key?.name === 'p') snapshotIndex = Math.max(snapshotIndex - 1, 0);
  render();
});

render();

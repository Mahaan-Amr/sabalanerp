import { emitKeypressEvents } from 'node:readline';
import { initialState, reduce, type Action, type PrototypeState } from './model';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

let state = initialState();

const activeReservations = (value: PrototypeState) =>
  value.allocations.filter((allocation) => allocation.reservationActive)
    .map((allocation) => `${allocation.id}:${allocation.quantity}`)
    .join(', ') || 'none';

const render = () => {
  console.clear();
  const allocation = state.allocations.find((entry) => entry.id === state.candidate.allocationRevisionId)!;
  const current = state.pricingVersions.find((entry) => entry.evidence.versionId === state.currentPricingVersionId)!;
  console.log(`${bold}ISSUE 249 — IMMUTABLE PRICED-ALLOCATION PROTOTYPE${reset}`);
  console.log(`${dim}Question: do version identity + hashes + lockable heads make staleness and succession unambiguous?${reset}\n`);
  console.log(`${bold}Current approved pricing${reset}  ${state.currentPricingVersionId}  hash=${current.integrityHash.slice(0, 12)}…`);
  console.log(`${bold}Candidate allocation${reset}       ${allocation.id}  frozen=${allocation.pricingVersionId}`);
  console.log(`${bold}Candidate status${reset}           ${state.candidate.status}${state.candidate.reason ? ` (${state.candidate.reason})` : ''}`);
  console.log(`${bold}Active reservations${reset}        ${activeReservations(state)}`);
  console.log(`${bold}Issued bundle${reset}              ${state.issuedBundleNumber || 'none'}`);
  console.log(`${bold}Allocation chain${reset}`);
  for (const entry of state.allocations) {
    console.log(`  ${entry.id} <- ${entry.predecessorRevisionId || 'origin'} | ${entry.pricingVersionId} | reserved=${entry.reservationActive}`);
  }
  console.log(`\n${bold}Last transition${reset}\n${state.lastTransition}\n`);
  console.log(`${bold}[p]${reset} ${dim}approve replacement pricing${reset}  ${bold}[a]${reset} ${dim}Accounting accept${reset}  ${bold}[s]${reset} ${dim}finalize successor${reset}`);
  console.log(`${bold}[t]${reset} ${dim}tamper pricing payload${reset}     ${bold}[l]${reset} ${dim}tamper allocation${reset}   ${bold}[i]${reset} ${dim}drop required currency${reset}`);
  console.log(`${bold}[r]${reset} ${dim}reset${reset}                      ${bold}[q]${reset} ${dim}quit${reset}`);
};

const actions: Record<string, Action> = {
  p: { type: 'APPROVE_REPLACEMENT_PRICING' },
  a: { type: 'ACCOUNTING_ACCEPT' },
  s: { type: 'FINALIZE_SUCCESSOR' },
  t: { type: 'TAMPER_CURRENT_PRICING' },
  l: { type: 'TAMPER_ALLOCATION' },
  i: { type: 'DROP_REQUIRED_PRICING_FIELD' },
  r: { type: 'RESET' },
};

emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
render();

process.stdin.on('keypress', (_input, key) => {
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    console.clear();
    return;
  }
  const action = actions[key.name || ''];
  if (action) state = reduce(state, action);
  render();
});

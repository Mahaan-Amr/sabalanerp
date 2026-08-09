import {
  assertLedger,
  createLedger,
  issueBundle,
  postCorrection,
  recordExit,
  replaceBundle,
} from './model.mjs';

const fresh = () => createLedger({ contracts: [
  {
    id: 'C-100', currency: 'TOMAN', discount: '10', rows: [
      {
        id: 'ROW-A', contractedQuantity: '3', canonicalAllInTotal: '100', discountBasis: '55',
        components: { material: '55', cutting: '10', finishing: '10', tooling: '25' },
      },
      {
        id: 'ROW-B', contractedQuantity: '2', canonicalAllInTotal: '50', discountBasis: '45',
        components: { material: '45', cutting: '0', finishing: '2', tooling: '3' },
      },
    ],
  },
  {
    id: 'C-200', currency: 'TOMAN', discount: '0', rows: [
      {
        id: 'ROW-C', contractedQuantity: '2', canonicalAllInTotal: '75', discountBasis: '75',
        components: { material: '75', cutting: '0', finishing: '0', tooling: '0' },
      },
    ],
  },
] });

const issue = (id, number, allocationRevisionId, lines) => (ledger) =>
  issueBundle(ledger, { id, number, allocationRevisionId, lines });

export const scenarios = [
  {
    key: '1', name: 'Partial shipments and exact final remainder',
    steps: [
      issue('B-1', '1258', 'AR-1', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '1' }]),
      issue('B-2', '1259', 'AR-2', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '1' }]),
      issue('B-3', '1260', 'AR-3', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '1' }]),
    ],
    verdict: 'The first two gross lines are 33.333333333333 and discounts 1.833333333333; the final line receives both residues. Gross reaches exactly 100 and discount exactly 5.5.',
  },
  {
    key: '2', name: 'Attached costs remain inside the all-in row total',
    steps: [
      issue('B-1', '1258', 'AR-1', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '3' }]),
    ],
    verdict: 'ROW-A allocates exactly 100, not 140. Component detail is evidence only; it is never added to canonicalAllInTotal again.',
  },
  {
    key: '3', name: 'Contract discount and multi-contract subtotals',
    steps: [
      issue('B-1', '1258', 'AR-1', [
        { contractId: 'C-100', rowId: 'ROW-A', quantity: '1.5' },
        { contractId: 'C-100', rowId: 'ROW-B', quantity: '2' },
        { contractId: 'C-200', rowId: 'ROW-C', quantity: '1' },
      ]),
    ],
    verdict: 'Each contract keeps its own discount target and subtotal. The bundle may sum them only because customer, destination, and currency are assumed identical.',
  },
  {
    key: '4', name: 'Pre-exit void and replacement reuse one priced allocation',
    steps: [
      issue('B-1', '1258', 'AR-1', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '1' }]),
      (ledger) => replaceBundle(ledger, { bundleId: 'B-1', replacementId: 'B-2', replacementNumber: '1259' }),
    ],
    verdict: 'The voided and replacement artifacts remain in history, but both point at the same financial event. Replacement does not allocate money twice.',
  },
  {
    key: '5', name: 'Posted verified return and later reshipment',
    steps: [
      issue('B-1', '1258', 'AR-1', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '3' }]),
      (ledger) => recordExit(ledger, 'B-1'),
      (ledger) => postCorrection(ledger, { id: 'ADJ-1', bundleId: 'B-1', verifiedReturn: true,
        lines: [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '-1' }] }),
      issue('B-2', '1259', 'AR-2', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '1' }]),
    ],
    verdict: 'The original stays immutable, the negative adjustment is additive, and the reshipment receives the exact final remainder so current representation returns to the approved targets.',
  },
  {
    key: '6', name: 'Post-exit row reattribution',
    steps: [
      issue('B-1', '1258', 'AR-1', [
        { contractId: 'C-100', rowId: 'ROW-A', quantity: '1' },
        { contractId: 'C-100', rowId: 'ROW-B', quantity: '1' },
      ]),
      (ledger) => recordExit(ledger, 'B-1'),
      (ledger) => postCorrection(ledger, { id: 'ADJ-1', bundleId: 'B-1', verifiedReturn: true, lines: [
        { contractId: 'C-100', rowId: 'ROW-A', quantity: '-0.25' },
        { contractId: 'C-100', rowId: 'ROW-B', quantity: '0.25' },
      ] }),
    ],
    verdict: 'A row-attribution correction is one atomic signed event: source and destination rows remain distinct even when products look identical.',
  },
  {
    key: '7', name: 'Full return heals both quantity and monetary residue',
    steps: [
      issue('B-1', '1258', 'AR-1', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '1' }]),
      (ledger) => recordExit(ledger, 'B-1'),
      (ledger) => postCorrection(ledger, { id: 'ADJ-1', bundleId: 'B-1', verifiedReturn: true,
        lines: [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '-1' }] }),
    ],
    verdict: 'When represented quantity reaches zero, the adjustment receives the exact negative monetary remainder; no fractional residue survives.',
  },
  {
    key: '8', name: 'Over-allocation remains visible',
    steps: [
      issue('B-1', '1258', 'AR-1', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '3' }]),
      (ledger) => recordExit(ledger, 'B-1'),
      (ledger) => postCorrection(ledger, { id: 'ADJ-1', bundleId: 'B-1', verifiedReturn: false,
        lines: [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '0.25' }] }),
    ],
    verdict: 'A positive correction beyond contracted quantity is not clamped. Quantity and money both remain visibly over target for review.',
  },
  {
    key: '9', name: 'Immutable opposite correction',
    steps: [
      issue('B-1', '1258', 'AR-1', [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '1' }]),
      (ledger) => recordExit(ledger, 'B-1'),
      (ledger) => postCorrection(ledger, { id: 'ADJ-1', bundleId: 'B-1', verifiedReturn: true,
        lines: [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '-0.25' }] }),
      (ledger) => postCorrection(ledger, { id: 'ADJ-2', bundleId: 'B-1', reversalOfId: 'ADJ-1', verifiedReturn: false,
        lines: [{ contractId: 'C-100', rowId: 'ROW-A', quantity: '0.25' }] }),
    ],
    verdict: 'The opposite correction restores the exact prior represented quantity, gross, discount, and net state while both adjustments remain immutable history.',
  },
];

export const runScenario = (scenario) => {
  const ledger = fresh();
  const snapshots = [{ label: 'Initial frozen pricing state', ledger: structuredClone(ledger) }];
  scenario.steps.forEach((step, index) => {
    step(ledger);
    assertLedger(ledger);
    snapshots.push({ label: `After action ${index + 1}`, ledger: structuredClone(ledger) });
  });
  return { scenario, snapshots };
};

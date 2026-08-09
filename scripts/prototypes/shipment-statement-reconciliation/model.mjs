// PROTOTYPE ONLY — pure shipment-statement monetary allocation model.

export const QUANTITY_SCALE = 3;
export const MONEY_SCALE = 12;

const pow10 = (scale) => 10n ** BigInt(scale);

export const parseFixed = (value, scale) => {
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid fixed-point value: ${value}`);
  const fraction = match[3] || '';
  if (fraction.length > scale) throw new Error(`${value} exceeds scale ${scale}`);
  const atoms = BigInt(match[2]) * pow10(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale));
  return match[1] ? -atoms : atoms;
};

export const formatFixed = (atoms, scale, trim = false) => {
  const sign = atoms < 0n ? '-' : '';
  const absolute = atoms < 0n ? -atoms : atoms;
  const base = pow10(scale);
  const whole = absolute / base;
  let fraction = String(absolute % base).padStart(scale, '0');
  if (trim) fraction = fraction.replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
};

const proportional = (targetAtoms, deltaQuantity, contractedQuantity) =>
  (targetAtoms * deltaQuantity) / contractedQuantity;

const clone = (value) => structuredClone(value);
const rowKey = (contractId, rowId) => `${contractId}:${rowId}`;

const distributeDiscount = (contract) => {
  const eligible = contract.rows.filter((row) => row.discountBasisAtoms > 0n);
  const basisTotal = eligible.reduce((sum, row) => sum + row.discountBasisAtoms, 0n);
  let allocated = 0n;
  eligible.forEach((row, index) => {
    row.discountTargetAtoms = index === eligible.length - 1
      ? contract.discountAtoms - allocated
      : (contract.discountAtoms * row.discountBasisAtoms) / basisTotal;
    allocated += row.discountTargetAtoms;
  });
};

export const createLedger = (input) => {
  const contracts = input.contracts.map((contract) => ({
    ...contract,
    discountAtoms: parseFixed(contract.discount, MONEY_SCALE),
    rows: contract.rows.map((row) => ({
      ...row,
      contractedQuantityUnits: parseFixed(row.contractedQuantity, QUANTITY_SCALE),
      grossTargetAtoms: parseFixed(row.canonicalAllInTotal, MONEY_SCALE),
      discountBasisAtoms: parseFixed(row.discountBasis, MONEY_SCALE),
      discountTargetAtoms: 0n,
      representedQuantityUnits: 0n,
      representedGrossAtoms: 0n,
      representedDiscountAtoms: 0n,
    })),
  }));
  contracts.forEach(distributeDiscount);
  return { schemaVersion: 1, sequence: 0, contracts, bundles: [], adjustments: [], events: [] };
};

const findRow = (ledger, contractId, rowId) => {
  const contract = ledger.contracts.find((item) => item.id === contractId);
  const row = contract?.rows.find((item) => item.id === rowId);
  if (!contract || !row) throw new Error(`Unknown row ${rowKey(contractId, rowId)}`);
  return { contract, row };
};

const calculateDelta = (row, deltaQuantityUnits) => {
  const afterQuantity = row.representedQuantityUnits + deltaQuantityUnits;
  let grossAtoms;
  let discountAtoms;
  if (afterQuantity === 0n) {
    grossAtoms = -row.representedGrossAtoms;
    discountAtoms = -row.representedDiscountAtoms;
  } else if (afterQuantity === row.contractedQuantityUnits) {
    grossAtoms = row.grossTargetAtoms - row.representedGrossAtoms;
    discountAtoms = row.discountTargetAtoms - row.representedDiscountAtoms;
  } else {
    grossAtoms = proportional(row.grossTargetAtoms, deltaQuantityUnits, row.contractedQuantityUnits);
    discountAtoms = proportional(row.discountTargetAtoms, deltaQuantityUnits, row.contractedQuantityUnits);
  }
  return { afterQuantity, grossAtoms, discountAtoms, netAtoms: grossAtoms - discountAtoms };
};

const appendFinancialEvent = (ledger, type, reference, lines) => {
  const calculated = lines.map((line) => {
    const { row } = findRow(ledger, line.contractId, line.rowId);
    const quantityUnits = parseFixed(line.quantity, QUANTITY_SCALE);
    if (quantityUnits === 0n) throw new Error('A financial event line cannot have zero quantity.');
    return { ...line, quantityUnits, ...calculateDelta(row, quantityUnits) };
  });
  for (const line of calculated) {
    const { row } = findRow(ledger, line.contractId, line.rowId);
    row.representedQuantityUnits = line.afterQuantity;
    row.representedGrossAtoms += line.grossAtoms;
    row.representedDiscountAtoms += line.discountAtoms;
  }
  const event = { sequence: ++ledger.sequence, type, reference, lines: calculated };
  ledger.events.push(event);
  return event;
};

export const issueBundle = (ledger, input) => {
  const event = appendFinancialEvent(ledger, 'ALLOCATION_PRICED', input.allocationRevisionId, input.lines);
  const bundle = {
    id: input.id,
    number: input.number,
    allocationRevisionId: input.allocationRevisionId,
    status: 'ISSUED',
    exited: false,
    replacesBundleId: null,
    financialEventSequence: event.sequence,
    lines: event.lines,
  };
  ledger.bundles.push(bundle);
  return bundle;
};

export const replaceBundle = (ledger, input) => {
  const original = ledger.bundles.find((bundle) => bundle.id === input.bundleId);
  if (!original || original.status !== 'ISSUED' || original.exited) {
    throw new Error('Only an unexited issued bundle can be replaced.');
  }
  original.status = 'VOIDED';
  const replacement = {
    ...clone(original),
    id: input.replacementId,
    number: input.replacementNumber,
    status: 'ISSUED',
    replacesBundleId: original.id,
  };
  ledger.bundles.push(replacement);
  return replacement;
};

export const recordExit = (ledger, bundleId) => {
  const bundle = ledger.bundles.find((item) => item.id === bundleId);
  if (!bundle || bundle.status !== 'ISSUED') throw new Error('An issued bundle is required.');
  bundle.exited = true;
};

export const postCorrection = (ledger, input) => {
  const bundle = ledger.bundles.find((item) => item.id === input.bundleId);
  if (!bundle?.exited) throw new Error('Only an exited bundle can receive an adjustment.');
  if (input.lines.some((line) => parseFixed(line.quantity, QUANTITY_SCALE) < 0n) && !input.verifiedReturn) {
    throw new Error('Negative corrections require verified return evidence.');
  }
  const event = appendFinancialEvent(ledger, 'POSTED_DISPATCH_CORRECTION', input.id, input.lines);
  const adjustment = {
    id: input.id,
    shipmentNumber: bundle.number,
    sequence: ledger.adjustments.filter((item) => item.shipmentNumber === bundle.number).length + 1,
    reversalOfId: input.reversalOfId || null,
    verifiedReturn: Boolean(input.verifiedReturn),
    lines: event.lines,
  };
  ledger.adjustments.push(adjustment);
  return adjustment;
};

export const assertLedger = (ledger) => {
  for (const contract of ledger.contracts) {
    const discountTarget = contract.rows.reduce((sum, row) => sum + row.discountTargetAtoms, 0n);
    if (discountTarget !== contract.discountAtoms) throw new Error(`${contract.id}: discount targets do not reconcile.`);
    for (const row of contract.rows) {
      if (row.representedQuantityUnits === 0n && (row.representedGrossAtoms !== 0n || row.representedDiscountAtoms !== 0n)) {
        throw new Error(`${rowKey(contract.id, row.id)}: zero quantity does not reconcile to zero money.`);
      }
      if (row.representedQuantityUnits === row.contractedQuantityUnits
        && (row.representedGrossAtoms !== row.grossTargetAtoms || row.representedDiscountAtoms !== row.discountTargetAtoms)) {
        throw new Error(`${rowKey(contract.id, row.id)}: final quantity did not receive the exact monetary remainder.`);
      }
    }
  }
  return true;
};

const money = (atoms) => formatFixed(atoms, MONEY_SCALE);
const quantity = (units) => formatFixed(units, QUANTITY_SCALE);

export const presentLedger = (ledger) => ({
  sequence: ledger.sequence,
  contracts: ledger.contracts.map((contract) => ({
    id: contract.id,
    currency: contract.currency,
    discountTarget: money(contract.discountAtoms),
    rows: contract.rows.map((row) => ({
      id: row.id,
      components: row.components,
      contractedQuantity: quantity(row.contractedQuantityUnits),
      canonicalAllInTarget: money(row.grossTargetAtoms),
      discountBasis: money(row.discountBasisAtoms),
      rowDiscountTarget: money(row.discountTargetAtoms),
      representedQuantity: quantity(row.representedQuantityUnits),
      representedGross: money(row.representedGrossAtoms),
      representedDiscount: money(row.representedDiscountAtoms),
      representedNet: money(row.representedGrossAtoms - row.representedDiscountAtoms),
    })),
  })),
  bundles: ledger.bundles.map((bundle) => ({
    id: bundle.id,
    number: bundle.number,
    status: bundle.status,
    exited: bundle.exited,
    replacesBundleId: bundle.replacesBundleId,
    financialEventSequence: bundle.financialEventSequence,
    lines: bundle.lines.map((line) => ({
      row: rowKey(line.contractId, line.rowId),
      quantity: quantity(line.quantityUnits),
      gross: money(line.grossAtoms),
      discount: money(line.discountAtoms),
      net: money(line.netAtoms),
    })),
  })),
  adjustments: ledger.adjustments.map((adjustment) => ({
    id: adjustment.id,
    reference: `${adjustment.shipmentNumber} / adjustment ${adjustment.sequence}`,
    reversalOfId: adjustment.reversalOfId,
    verifiedReturn: adjustment.verifiedReturn,
    lines: adjustment.lines.map((line) => ({
      row: rowKey(line.contractId, line.rowId),
      quantity: quantity(line.quantityUnits),
      gross: money(line.grossAtoms),
      discount: money(line.discountAtoms),
      net: money(line.netAtoms),
    })),
  })),
});

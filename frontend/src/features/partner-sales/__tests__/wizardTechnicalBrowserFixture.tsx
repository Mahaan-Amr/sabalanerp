import React from 'react';
import { ErpButton } from '@/components/erp';
import { parseCanonicalDecimal as decimal, parseStableIdentity as identity,
  type ProductOperationsTechnicalInput, type LongitudinalTechnicalInput, type SlabTechnicalInput,
} from '@sabalanerp/contract-product-graph';
import { OperationCollectionsSection } from '../../contract-creation/components/product-modal-system/OperationCollectionsSection';
import { LongitudinalProductSection } from '../../contract-creation/components/product-modal-system/LongitudinalProductSection';
import { SlabProductSection } from '../../contract-creation/components/product-modal-system/SlabProductSection';

// Real canonical calculations over explicit technical facts; no invented
// computed result, price input, transport, save reference or readiness grant.
export function WizardTechnicalBrowserFixture() {
  const [operations, setOperations] = React.useState<ProductOperationsTechnicalInput>({
    inputRevision: 1, productRowId: identity('product-row', 'browser-technical'),
    lengthMeters: decimal('1'), widthMeters: decimal('0.4'), quantity: 2,
    groups: [{ operationGroupId: identity('operation-group', 'browser-group'), scope: decimal('2') }],
    tools: [{ toolSelectionId: identity('tool-selection', 'browser-tool'), operationGroupId: identity('operation-group', 'browser-group'),
      catalogItemId: 'tool', catalogSnapshotVersion: '2026-08-27T10:00:00.000Z', name: 'نیم لول', unit: 'meter', edges: ['front'] }],
    finishings: [],
  });
  const [longitudinal, setLongitudinal] = React.useState<LongitudinalTechnicalInput>({
    inputRevision: 1, sourceBatchId: identity('source-batch', 'browser-longitudinal'),
    motherWidthMeters: decimal('0.4'), lengthMeters: decimal('1'), widthMeters: decimal('0.1'), quantity: 8,
    lengthDisplayUnit: 'm', widthDisplayUnit: 'cm', lastManualField: 'length', lastManualDimension: 'length',
    sawKerfEnabled: false, sawKerfMeters: decimal('0.003'), calibrationEnabled: false, calibrationSelection: 'manual',
  });
  const [slab, setSlab] = React.useState<SlabTechnicalInput>({
    inputRevision: 1, sourceBatchId: identity('source-batch', 'browser-slab'),
    lengthMeters: decimal('1'), widthMeters: decimal('1'), quantity: 2,
    lengthDisplayUnit: 'm', widthDisplayUnit: 'm', kerfMeters: decimal('0'), verticalCutSides: [],
    sourceRows: [{ sourceRowId: identity('slab-source-row', 'browser-source'), lengthMeters: decimal('2.008'), widthMeters: decimal('1.02'),
      quantity: 2, lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }],
  });
  return <main className="mx-auto max-w-5xl space-y-6 p-4" dir="rtl">
    <h1 className="text-2xl font-bold">پیش‌نمایش فنی بدون قیمت</h1>
    <section aria-label="عملیات فنی" className="space-y-3">
      <ErpButton label="تغییر طول برای آزمون" onClick={() => setOperations(current => ({ ...current,
        inputRevision: current.inputRevision + 1, lengthMeters: decimal(String(Number(current.lengthMeters) + 1)) }))} />
      <OperationCollectionsSection input={operations}
        onChange={next => setOperations({ ...next, inputRevision: operations.inputRevision + 1 })}
        loadTools={async () => []} loadFinishings={async () => []} />
    </section>
    <section aria-label="سنگ طولی فنی">
      <LongitudinalProductSection input={longitudinal} showValidation
        onChange={next => setLongitudinal({ ...next, inputRevision: longitudinal.inputRevision + 1 })} />
    </section>
    <section aria-label="اسلب فنی">
      <SlabProductSection input={slab} showValidation sawKerfMeters={decimal('0.005')}
        onChange={next => setSlab({ ...next, inputRevision: slab.inputRevision + 1 })} />
    </section>
  </main>;
}

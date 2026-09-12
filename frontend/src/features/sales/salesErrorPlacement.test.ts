import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpInlineState } from '@/components/erp';
import { getSalesOperationalErrorKind } from './salesOperationalError';
import CatalogImagePicker from '@/components/CatalogImagePicker';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('product edit validation is attached to editable fields', () => {
  const page = source('src/app/dashboard/sales/products/[id]/page.tsx');
  assert.match(page, /error=\{fieldErrors\.basePrice\}/);
  assert.match(page, /error=\{fieldErrors\.motherLengthValue\}/);
  assert.match(page, /fieldErrors\.images/);
  assert.match(page, /getSalesErrorSummary\(fieldErrors\)/);
});

test('contract, product, and partner action failures are rendered beside their row', () => {
  const contracts = source('src/app/dashboard/sales/contracts/page.tsx');
  const products = source('src/app/dashboard/sales/products/page.tsx');
  const partnerCases = source('src/features/partner-sales/cases/PartnerCaseRuntime.tsx');
  assert.match(contracts, /latestOperationError\(\(item\) => item\.contractId === contract\.id\)/);
  assert.match(contracts, /kind=\{rowError\.kind\}/);
  assert.match(products, /latestProductError\(product\.id\)/);
  assert.match(products, /kind=\{rowError\.kind\}/);
  assert.match(partnerCases, /latestCaseError\(row\.view\.owner\.caseId\)/);
  assert.match(partnerCases, /kind=\{error\.kind\}/);
});

test('failed product deletion closes confirmation before exposing its row error', () => {
  const page = source('src/app/dashboard/sales/products/page.tsx');
  const deleteHandler = page.slice(page.indexOf('const handleDeleteConfirm'), page.indexOf('const handleToggleStatus'));
  assert.equal(deleteHandler.match(/setDeleteConfirm\(\{ show: false, product: null \}\)/g)?.length, 3);
  assert.match(deleteHandler, /catch[\s\S]*setDeleteConfirm\(\{ show: false, product: null \}\)[\s\S]*reportRowError\(errorKey/);
});

test('accounting workflow lock is presented as stale state rather than missing permission', () => {
  const page = source('src/app/dashboard/sales/contracts/[id]/edit/page.tsx');
  assert.match(page, /accountingEditLocked[\s\S]{0,300}setErrorKind\('stale'\)/);
});

test('cached shipment warning retains the actionable refresh failure', () => {
  const summary = source('src/features/shipment-quantities/ShipmentQuantitySummary.tsx');
  assert.match(summary, /kind="stale" title=\{<>آخرین اطلاعات موفق نمایش داده می‌شود\. \{refreshError\}<\/>\}/);
});

test('catalog download failures normalize blob responses before building their message', () => {
  const modal = source('src/components/CatalogExcelSyncModal.tsx');
  assert.match(modal, /await normalizeSalesBlobError\(err\)/);
  assert.match(modal, /kind=\{visibleError\.kind\}/);
  assert.match(modal, /current\.filter\(item => item\.source !== source\)/);
  assert.match(modal, /downloadBlob\(response, `\$\{filenamePrefix\}-template\.xlsx`\);\s*clearError\('template'\)/);
  assert.doesNotMatch(modal, /setLoading\(true\);\s*setError\(null\);\s*const response = await (downloadTemplate|exportData|previewImport|applyImport)/);
});

test('every Sale blob PDF failure is normalized and partner preview reports its rejection', () => {
  for (const path of [
    'src/app/dashboard/sales/contracts/page.tsx',
    'src/app/dashboard/sales/contracts/[id]/page.tsx',
    'src/features/contract-creation/CreateContractWizardClient.tsx',
    'src/features/partner-sales/cases/PartnerCaseRuntime.tsx',
  ]) {
    assert.match(source(path), /normalizeSalesBlobError/);
  }
  const partner = source('src/features/partner-sales/cases/PartnerCaseRuntime.tsx');
  assert.match(partner, /const previewPdf = useCallback/);
  assert.match(partner, /failedAction: mode === 'FINAL' \? 'صدور سند فروش همکار' : 'پیش‌نمایش سند فروش همکار'/);
});

test('Sale load and mutation feedback retain HTTP semantic kinds', () => {
  const products = source('src/app/dashboard/sales/products/page.tsx');
  const detail = source('src/app/dashboard/sales/products/[id]/page.tsx');
  const create = source('src/app/dashboard/sales/products/create/page.tsx');
  const wizard = source('src/features/contract-creation/CreateContractWizardClient.tsx');
  const shipment = source('src/features/shipment-quantities/ShipmentQuantitySummary.tsx');
  assert.match(products, /kind=\{products\.length > 0 \? 'stale' : listErrorKind\}/);
  assert.match(detail, /kind=\{loadErrorKind\}/);
  assert.match(create, /kind: loadErrorKind/);
  assert.match(create, /kind=\{modalErrorKind\}/);
  assert.match(wizard, /kind=\{generalErrorKind\}/);
  assert.match(shipment, /kind=\{refreshErrorKind\}/);
});

test('leaving product edit mode clears validation that can no longer be corrected', () => {
  const detail = source('src/app/dashboard/sales/products/[id]/page.tsx');
  assert.match(detail, /const cancelEditing = \(\) => \{\s*if \(savedFormSnapshot\) setFormData\(savedFormSnapshot\);\s*setEditing\(false\);\s*setFieldErrors\(\{\}\);\s*setFeedback\(undefined\)/);
  assert.match(detail, /editing \? cancelEditing\(\) : setEditing\(true\)/);
  assert.match(detail, /onClick=\{cancelEditing\}/);
});

test('successful Sale retries clear superseded operational errors', () => {
  const wizard = source('src/features/contract-creation/CreateContractWizardClient.tsx');
  const detail = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  const list = source('src/app/dashboard/sales/contracts/page.tsx');
  const products = source('src/app/dashboard/sales/products/page.tsx');
  assert.match(wizard, /signatureErrorsRef\.current\.delete\(source\)[\s\S]*publishSignatureError\(\)/);
  assert.match(detail, /downloadBlobResponse\([\s\S]*?clearOperationalError\(errorSource\)/);
  assert.match(detail, /openPdfUrl\(pdfResponse\.data\.data\.url, true\);\s*clearOperationalError\(errorSource\)/);
  assert.doesNotMatch(detail, /setActionLoading\('(download|print|print-summary)'\);\s*setError/);
  assert.match(list, /downloadBlobResponse\([\s\S]*?clearOperationError\(errorKey\)/);
  assert.match(products, /if \(response\.data\.success\) \{\s*clearRowError\(errorKey\)/);
  assert.match(wizard, /const handleDataLoadingError[\s\S]*?setDataLoadingError\(\{ message: error, kind \}\)/);
  assert.match(wizard, /const handleDataLoaded[\s\S]*?setDataLoadingError\(undefined\)[\s\S]*?onDataLoaded: handleDataLoaded/);
  assert.doesNotMatch(wizard, /const handleDataLoaded[\s\S]{0,300}delete next\.general/);
  assert.match(list, /if \(response\.data\.success\) \{[\s\S]*?clearOperationError\('contracts'\)/);
});

test('data retry clears only the error produced by the recovered source', () => {
  const loading = source('src/features/contract-creation/hooks/useDataLoading.ts');
  assert.match(loading, /activeErrorsRef\.current\.set\(source, \{ message, kind, order: errorSequenceRef\.current \}\)/);
  assert.match(loading, /if \(!activeErrorsRef\.current\.delete\(source\)\) return/);
  assert.match(loading, /Array\.from\(activeErrorsRef\.current\.values\(\)\)[\s\S]*?sort\(\(left, right\) => right\.order - left\.order\)/);
  assert.match(loading, /setCustomers\(data\);\s*recoverError\('customers'\)/);
  assert.match(loading, /!isLatestRequest\('customers', requestSequence\)/);
  const contracts = source('src/app/dashboard/sales/contracts/page.tsx');
  assert.match(contracts, /requestSequence !== contractLoadSequenceRef\.current/);
  assert.match(contracts, /source: 'profile'/);
});

test('signature operations render their HTTP semantic kind', () => {
  const wizard = source('src/features/contract-creation/CreateContractWizardClient.tsx');
  const signature = source('src/features/contract-creation/components/steps/Step8DigitalSignature.tsx');
  assert.match(wizard, /reportSignatureError\(errorSource,[\s\S]*getSalesOperationalErrorKind\(/);
  assert.match(wizard, /signatureErrorKind=\{signatureErrorKind\}/);
  assert.match(wizard, /const handleResendConfirmation[\s\S]*?beginSignatureOperation\(errorSource\)[\s\S]*?salesAPI\.resendConfirmation[\s\S]*?clearSignatureError\(errorSource\)/);
  assert.match(signature, /kind=\{signatureErrorKind\} title=\{errors\.signature\}/);
});

test('concurrent Sale actions retain errors until the matching operation recovers', () => {
  const wizard = source('src/features/contract-creation/CreateContractWizardClient.tsx');
  const contractDetail = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  const contracts = source('src/app/dashboard/sales/contracts/page.tsx');
  const products = source('src/app/dashboard/sales/products/page.tsx');
  const partnerCases = source('src/features/partner-sales/cases/PartnerCaseRuntime.tsx');

  assert.match(wizard, /signatureErrorsRef = useRef\(new Map/);
  assert.match(wizard, /signatureOperationTrackerRef = useRef\(createLatestRequestTracker\(\)\)/);
  assert.match(wizard, /if \(!isLatestSignatureOperation\(errorSource, requestSequence\)\) return/);
  assert.doesNotMatch(wizard, /const handle(DownloadPdf|PrintContract|SendConfirmation|ResendConfirmation)[\s\S]{0,500}setErrors\(previous => \(\{ \.\.\.previous, signature: '' \}\)\)/);

  assert.match(contractDetail, /operationalErrors, setOperationalErrors/);
  assert.match(contractDetail, /operationTrackerRef = useRef\(createLatestRequestTracker\(\)\)/);
  assert.match(contractDetail, /current\.filter\(\(item\) => item\.source !== source\)/);
  assert.match(contractDetail, /if \(!isLatestOperation\(errorSource, requestSequence\)\) return/);
  assert.match(contracts, /const errorKey = `action:\$\{contractId\}:download`/);
  assert.match(contracts, /const errorKey = `action:\$\{actionKey\}`/);
  assert.match(contracts, /reportOperationError\(errorKey,[\s\S]*failedAction: 'دریافت فایل PDF قرارداد'/);
  assert.match(products, /const errorKey = `\$\{product\.id\}:delete`/);
  assert.match(products, /const errorKey = `\$\{product\.id\}:toggle`/);
  assert.match(partnerCases, /const errorKey = `\$\{caseId\}:\$\{operation\}`/);
  assert.match(partnerCases, /actionTrackerRef = useRef\(createLatestRequestTracker\(\)\)/);
});

test('concurrent Sale actions retain independent pending state', () => {
  const contracts = source('src/app/dashboard/sales/contracts/page.tsx');
  const detail = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  const products = source('src/app/dashboard/sales/products/page.tsx');
  assert.match(contracts, /pendingActions\.has\(`action:\$\{contract\.id\}:approve`\)/);
  assert.match(detail, /pendingOperations\.has\('action:approve'\)/);
  assert.match(products, /pendingRowActions\.has\(`\$\{product\.id\}:toggle`\)/);
});

test('partial product master data keeps prior choices and reports the failed response', () => {
  const create = source('src/app/dashboard/sales/products/create/page.tsx');
  assert.match(create, /const failedResponse = responses\.find\(\(response\) => !response\.data\.success\)/);
  assert.match(create, /if \(failedResponse\)[\s\S]*?setLoadError[\s\S]*?return;[\s\S]*?setMasterData/);
});

test('Sale data retries preserve visible failures until a current request succeeds', () => {
  const create = source('src/app/dashboard/sales/products/create/page.tsx');
  const detail = source('src/app/dashboard/sales/products/[id]/page.tsx');
  const contractDetail = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  const contracts = source('src/app/dashboard/sales/contracts/page.tsx');

  assert.match(create, /masterDataRequestSequenceRef/);
  assert.doesNotMatch(create, /setLoading\(true\);\s*setLoadError\(''\)/);
  assert.match(detail, /productRequestSequenceRef/);
  assert.doesNotMatch(detail, /setLoading\(true\);\s*setLoadError\(''\)/);
  assert.doesNotMatch(detail, /setSaving\(true\);\s*setFeedback\(undefined\)/);
  assert.match(contractDetail, /failedAction: 'دریافت فایل PDF قرارداد'/);
  assert.match(contractDetail, /action=\{\{ label: 'دریافت دوباره', onClick: \(\) => void loadContract\(\) \}\}/);
  assert.match(contractDetail, /if \(loading && !contract\)/);
  assert.match(contractDetail, /آخرین اطلاعات موفق قرارداد نمایش داده می‌شود/);
  assert.match(detail, /if \(loading && !product\)/);
  assert.match(detail, /آخرین اطلاعات موفق محصول نمایش داده می‌شود/);
  assert.match(contracts, /label: 'دریافت دوباره دسترسی‌ها', onClick: loadCurrentUser/);
});

test('resolved Sale failure envelopes are routed to operational feedback', () => {
  const contractDetail = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  const catalog = source('src/components/CatalogExcelSyncModal.tsx');
  const shipment = source('src/features/shipment-quantities/ShipmentQuantitySummary.tsx');
  const wizard = source('src/features/contract-creation/CreateContractWizardClient.tsx');
  const dataLoading = source('src/features/contract-creation/hooks/useDataLoading.ts');

  assert.match(contractDetail, /assertSuccessfulSalesResponse\(response\)/);
  assert.match(catalog, /assertSuccessfulSalesDownload\(response\)/);
  assert.match(catalog, /assertSuccessfulSalesResponse\(response\)/);
  assert.match(shipment, /assertSuccessfulSalesResponse\(response\)/);
  assert.match(wizard, /assertSuccessfulSalesResponse\(response\)/);
  assert.match(dataLoading, /if \(!profile\) return/);
});

test('Sale permission and seller loads expose recoverable failures', () => {
  const contractEdit = source('src/app/dashboard/sales/contracts/[id]/edit/page.tsx');
  const contractDetail = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  const contracts = source('src/app/dashboard/sales/contracts/page.tsx');
  const products = source('src/app/dashboard/sales/products/page.tsx');
  const partnerCases = source('src/features/partner-sales/cases/PartnerCaseRuntime.tsx');

  assert.match(contractEdit, /assertSuccessfulSalesResponse\(profileResponse\)/);
  assert.match(contractEdit, /retryLoad \? 'تلاش دوباره'/);
  assert.match(contractDetail, /showOperationalError\('profile'/);
  assert.match(contractDetail, /showOperationalError\('sellers'/);
  assert.match(contracts, /else \{\s*const failure = \{ response \};\s*reportOperationError\('profile'/);
  assert.match(products, /setProfileError\(/);
  assert.match(products, /دریافت دسترسی‌ها/);
  assert.match(partnerCases, /assertSuccessfulSalesResult\(result/);
  assert.match(partnerCases, /onIssue: row\.snapshotId \? \(\) => void previewPdf\(row\.view\.owner\.caseId, row\.snapshotId!, 'FINAL'\)/);
  assert.doesNotMatch(partnerCases, /onIssue:[^\n]+runAction/);
});

test('contract detail renders permission and stale failures with their semantic kind', () => {
  const page = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  assert.match(page, /if \(loadError\) return \([\s\S]*kind=\{loadError\.kind\}/);
  assert.match(page, /kind=\{visibleOperationalError\.kind\}/);
  assert.match(page, /getSalesOperationalErrorKind/);
});

test('real HTTP response classes render as warning, permission, or danger states', () => {
  for (const status of [404, 409, 410, 412]) {
    const html = renderToStaticMarkup(React.createElement(ErpInlineState, {
      kind: getSalesOperationalErrorKind({ response: { status } }),
      title: `status-${status}`,
    }));
    assert.match(html, /role="status"/);
    assert.match(html, /sds-tone-warning/);
  }
  const permission = renderToStaticMarkup(React.createElement(ErpInlineState, {
    kind: getSalesOperationalErrorKind({ response: { status: 403 } }), title: 'permission',
  }));
  assert.match(permission, /role="status"/);
  assert.match(permission, /sds-tone-neutral/);
  const failure = renderToStaticMarkup(React.createElement(ErpInlineState, {
    kind: getSalesOperationalErrorKind({ response: { status: 500 } }), title: 'failure',
  }));
  assert.match(failure, /role="alert"/);
  assert.match(failure, /sds-tone-danger/);
});

test('image validation is associated with the actual file input', () => {
  const html = renderToStaticMarkup(React.createElement(CatalogImagePicker, {
    images: [],
    onChange: () => undefined,
    error: 'تصویر معتبر را انتخاب کنید.',
  }));
  assert.match(html, /aria-invalid="true"/);
  const errorId = html.match(/aria-errormessage="([^"]+)"/)?.[1];
  assert.ok(errorId);
  assert.match(html, new RegExp(`id="${errorId}"[^>]*role="alert"`));
});

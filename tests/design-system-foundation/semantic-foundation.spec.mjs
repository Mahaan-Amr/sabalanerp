import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const tokenSource = read('frontend/src/styles/design-system-tokens.css');
const sharedModuleSource = read('frontend/src/components/erp/index.tsx');
const guardSource = read('frontend/src/app/dashboard/security/page.tsx');
const productSelectionSource = read(
  'frontend/src/features/contract-creation/components/steps/Step5ProductSelection.tsx'
);
const focusedProductSources = [
  'CanonicalStairLayerSummary.tsx',
  'ContractRemaindersSection.tsx',
  'LongitudinalProductSection.tsx',
  'OperationCollectionsSection.tsx',
  'PreparedProductSection.tsx',
  'SlabProductSection.tsx',
  'StairLayersSection.tsx',
  'StairProductSection.tsx',
  'productModalPrimitives.tsx'
].map((path) => [
  path,
  read(`frontend/src/features/contract-creation/components/product-modal-system/${path}`)
]);
const focusedProductOverlaySources = [
  'CompactProductConfigurationModal.tsx',
  'RemainingStoneModal.tsx'
].map((path) => [
  path,
  read(`frontend/src/features/contract-creation/components/modals/${path}`)
]);
const contractWizardSources = [
  ['CreateContractWizardClient.tsx', read('frontend/src/features/contract-creation/CreateContractWizardClient.tsx')],
  ['PaymentEntryModal.tsx', read('frontend/src/features/contract-creation/components/modals/PaymentEntryModal.tsx')],
  ['WizardNavigation.tsx', read('frontend/src/features/contract-creation/components/shared/WizardNavigation.tsx')],
  ['WizardProgressBar.tsx', read('frontend/src/features/contract-creation/components/shared/WizardProgressBar.tsx')],
  ...[
    'Step1ContractDate.tsx',
    'Step2CustomerSelection.tsx',
    'Step3ProjectManagement.tsx',
    'Step5ProductSelection.tsx',
    'Step6DeliverySchedule.tsx',
    'Step7PaymentMethod.tsx',
    'Step8DigitalSignature.tsx'
  ].map((path) => [
    path,
    read(`frontend/src/features/contract-creation/components/steps/${path}`)
  ])
];
const layoutSource = read('frontend/src/app/layout.tsx');
const dashboardShellSources = [
  ['dashboard/layout.tsx', read('frontend/src/app/dashboard/layout.tsx')],
  ['WorkspaceNavigation.tsx', read('frontend/src/components/WorkspaceNavigation.tsx')],
  ['WorkspaceSwitcher.tsx', read('frontend/src/components/WorkspaceSwitcher.tsx')],
  ['ThemeToggle.tsx', read('frontend/src/components/ThemeToggle.tsx')]
];
const sharedFieldSources = [
  ['FormattedNumberInput.tsx', read('frontend/src/components/FormattedNumberInput.tsx')]
];
const crmSources = [
  'page.tsx',
  'customers/page.tsx',
  'customers/create/page.tsx',
  'customers/[id]/page.tsx',
  'customers/[id]/edit/page.tsx',
  'follow-ups/page.tsx',
  'follow-ups/create/page.tsx',
  'potential-projects/page.tsx',
  'potential-projects/create/page.tsx',
  'potential-projects/[id]/page.tsx'
].map((path) => [path, read(`frontend/src/app/dashboard/crm/${path}`)]);
const salesSources = [
  ['sales/page.tsx', read('frontend/src/app/dashboard/sales/page.tsx')],
  ['sales/contracts/page.tsx', read('frontend/src/app/dashboard/sales/contracts/page.tsx')],
  ['sales/contracts/[id]/page.tsx', read('frontend/src/app/dashboard/sales/contracts/[id]/page.tsx')],
  ['sales/products/page.tsx', read('frontend/src/app/dashboard/sales/products/page.tsx')],
  ['sales/products/create/page.tsx', read('frontend/src/app/dashboard/sales/products/create/page.tsx')],
  ['sales/products/[id]/page.tsx', read('frontend/src/app/dashboard/sales/products/[id]/page.tsx')],
  ['sales/reports/page.tsx', read('frontend/src/app/dashboard/sales/reports/page.tsx')],
  ['contract-templates/page.tsx', read('frontend/src/app/dashboard/contract-templates/page.tsx')],
  ['contract-templates/create/page.tsx', read('frontend/src/app/dashboard/contract-templates/create/page.tsx')],
  ['ProductImportExportModal.tsx', read('frontend/src/components/ProductImportExportModal.tsx')],
  ['SalesReportingDashboard.tsx', read('frontend/src/components/reporting/SalesReportingDashboard.tsx')]
];
const inventoryLogisticsSources = [
  ...[
    'page.tsx',
    'master-data/page.tsx',
    'services/page.tsx',
    'services/cutting-types/create/page.tsx',
    'services/cutting-types/edit/[id]/page.tsx',
    'services/services/create/page.tsx',
    'services/services/edit/[id]/page.tsx',
    'services/stone-finishings/create/page.tsx',
    'services/stone-finishings/edit/[id]/page.tsx',
    'services/sub-services/create/page.tsx',
    'services/sub-services/edit/[id]/page.tsx'
  ].map((path) => [path, read(`frontend/src/app/dashboard/inventory/${path}`)]),
  ...[
    'page.tsx',
    'loadings/page.tsx',
    'loadings/new/page.tsx',
    'loadings/[id]/page.tsx',
    'logistics-ui.tsx'
  ].map((path) => [path, read(`frontend/src/app/dashboard/logistics/${path}`)]),
  ['CatalogImagePicker.tsx', read('frontend/src/components/CatalogImagePicker.tsx')]
];
const accountingSources = [
  ...[
    'page.tsx',
    'audit/page.tsx',
    'contracts/page.tsx',
    'contracts/[contractId]/page.tsx',
    'correction-requests/page.tsx',
    'invoice-candidates/page.tsx',
    'payments/page.tsx',
    'performance/page.tsx',
    'receivables/page.tsx',
    'settings/page.tsx',
    'tax/page.tsx'
  ].map((path) => [path, read(`frontend/src/app/dashboard/accounting/${path}`)]),
  ['AccountingActionModal.tsx', read('frontend/src/features/accounting/AccountingActionModal.tsx')],
  ['accountingUi.tsx', read('frontend/src/features/accounting/accountingUi.tsx')]
];
const peopleAdministrationSources = [
  ...[
    'page.tsx',
    'hiring/page.tsx',
    'hiring/[id]/page.tsx',
    'hiring/authorities/page.tsx',
    'hiring/collateral-templates/page.tsx',
    'migration/page.tsx',
    'personnel/page.tsx',
    'structure/page.tsx'
  ].map((path) => [path, read(`frontend/src/app/dashboard/hr/${path}`)]),
  ...[
    'page.tsx',
    'create/page.tsx',
    '[id]/page.tsx',
    '[id]/edit/page.tsx',
    '[id]/permissions/page.tsx'
  ].map((path) => [path, read(`frontend/src/app/dashboard/users/${path}`)]),
  ...['page.tsx', 'create/page.tsx'].map((path) => [
    path,
    read(`frontend/src/app/dashboard/departments/${path}`)
  ]),
  ...[
    'discount-settings/page.tsx',
    'permissions/page.tsx',
    'reports/page.tsx',
    'sabalan-calendar/page.tsx',
    'security/page.tsx',
    'settings/page.tsx'
  ].map((path) => [path, read(`frontend/src/app/dashboard/admin/${path}`)]),
  ['apply/page.tsx', read('frontend/src/app/apply/page.tsx')],
  ['apply/[token]/page.tsx', read('frontend/src/app/apply/[token]/page.tsx')],
  ['HiringLifecycle.tsx', read('frontend/src/features/hr-hiring/HiringLifecycle.tsx')]
];
const guardAttendanceSource = read('frontend/src/app/dashboard/security/attendance/page.tsx');
const guardVehiclesSource = read('frontend/src/app/dashboard/security/vehicles/page.tsx');
const guardPageSources = [
  'page.tsx',
  'attendance/page.tsx',
  'exceptions/page.tsx',
  'personnel/page.tsx',
  'reports/page.tsx',
  'reports/[personnelId]/page.tsx',
  'reports/shifts/[slotId]/page.tsx',
  'settings/page.tsx',
  'settings/attendance-roster/page.tsx',
  'settings/report-structure/page.tsx',
  'shifts/page.tsx',
  'shifts/[slotId]/page.tsx',
  'supervisor-reports/page.tsx',
  'vehicles/page.tsx'
].map((path) => [
  path,
  read(`frontend/src/app/dashboard/security/${path}`)
]);
const guardSupportingSources = [
  'EnhancedDropdown.tsx',
  'ExceptionRequestForm.tsx',
  'MissionAssignmentForm.tsx',
  'PersianCalendar.tsx',
  'PersianTimePicker.tsx',
  'SecurityNoticeHost.tsx'
].map((path) => [
  path,
  read(`frontend/src/components/${path}`)
]);

const variablesIn = (source) =>
  new Set(Array.from(source.matchAll(/--(sds-[\w-]+)\s*:/g), (match) => match[1]));

const valuesIn = (source) =>
  new Map(
    Array.from(
      source.matchAll(/--(sds-[\w-]+)\s*:\s*(#[\da-fA-F]{6})\s*;/g),
      (match) => [match[1], match[2]]
    )
  );

const luminance = (hex) => {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (first, second) => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

const lightAdapter = tokenSource.match(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const darkAdapter = tokenSource.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

test('light and dark adapters expose the same required semantic color meanings', () => {
  const requiredThemeTokens = [
    'sds-surface-canvas',
    'sds-surface-panel',
    'sds-surface-subtle',
    'sds-surface-raised',
    'sds-surface-overlay',
    'sds-text-primary',
    'sds-text-secondary',
    'sds-text-muted',
    'sds-text-inverse',
    'sds-border-subtle',
    'sds-border-default',
    'sds-border-strong',
    'sds-accent',
    'sds-accent-hover',
    'sds-accent-soft',
    'sds-focus-ring',
    'sds-success',
    'sds-warning',
    'sds-danger',
    'sds-info'
  ];
  const lightVariables = variablesIn(lightAdapter);
  const darkVariables = variablesIn(darkAdapter);

  for (const token of requiredThemeTokens) {
    assert.ok(lightVariables.has(token), `light adapter is missing --${token}`);
    assert.ok(darkVariables.has(token), `dark adapter is missing --${token}`);
  }
});

test('the semantic interface includes layout, shape, elevation, focus, and motion meanings', () => {
  const variables = variablesIn(lightAdapter);
  for (const token of [
    'sds-space-1',
    'sds-space-8',
    'sds-radius-control',
    'sds-radius-card',
    'sds-radius-dialog',
    'sds-shadow-card',
    'sds-shadow-raised',
    'sds-shadow-focus',
    'sds-motion-fast',
    'sds-motion-standard',
    'sds-motion-slow',
    'sds-control-height'
  ]) {
    assert.ok(variables.has(token), `semantic interface is missing --${token}`);
  }
  assert.match(tokenSource, /prefers-reduced-motion:\s*reduce/);
  assert.match(tokenSource, /:focus-visible/);
});

test('primary, secondary, accent, and status text meanings retain readable contrast', () => {
  for (const [adapterName, adapter] of [
    ['light', lightAdapter],
    ['dark', darkAdapter]
  ]) {
    const values = valuesIn(adapter);
    const panel = values.get('sds-surface-panel');
    assert.ok(panel, `${adapterName} panel must use a directly testable color`);
    for (const token of [
      'sds-text-primary',
      'sds-text-secondary',
      'sds-accent',
      'sds-success',
      'sds-warning',
      'sds-danger',
      'sds-info'
    ]) {
      const foreground = values.get(token);
      assert.ok(foreground, `${adapterName} --${token} must use a directly testable color`);
      assert.ok(
        contrast(foreground, panel) >= 4.5,
        `${adapterName} --${token} must meet 4.5:1 against the panel`
      );
    }
  }
});

test('the canonical module hides semantic styling behind its shared interface', () => {
  assert.match(sharedModuleSource, /className=\{cx\('sds-workspace/);
  assert.match(sharedModuleSource, /sds-action-solid/);
  assert.match(sharedModuleSource, /sds-tone-surface/);
  assert.match(sharedModuleSource, /motion-reduce:animate-none/);
});

test('Guard and Product Selection both cross the shared interface seam', () => {
  assert.match(guardSource, /from '@\/components\/erp'/);
  assert.match(guardSource, /<ErpWorkspacePage/);
  assert.match(productSelectionSource, /from '@\/components\/erp'/);
  assert.match(productSelectionSource, /className="sds-workspace /);
  assert.match(productSelectionSource, /<ErpInlineState kind="error"/);
  assert.match(productSelectionSource, /<ErpButton/);
  assert.match(layoutSource, /design-system-tokens\.css/);
});

test('Product Selection catalog and cart consume canonical presentation modules', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|gray|green|indigo|neutral|orange|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  assert.doesNotMatch(productSelectionSource, hardcodedPalette);
  assert.doesNotMatch(productSelectionSource, rawControl);
  assert.doesNotMatch(productSelectionSource, /جزئیات شناسه‌های فیزیکی/);
  assert.match(productSelectionSource, /data-contract-row-id=\{rowId\}/);
  assert.match(productSelectionSource, /controller\.cart\.(?:editItem|duplicateItem|removeItem)\(rowId\)/);
});

test('focused Product Selection workflows use one semantic dialog and control interface', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|gray|green|indigo|neutral|orange|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [path, source] of [...focusedProductSources, ...focusedProductOverlaySources]) {
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
  }
  for (const [path, source] of focusedProductOverlaySources) {
    assert.match(source, /<CentralProductModalShell/, `${path} must share the canonical dialog`);
  }
  const shell = focusedProductSources.find(([path]) => path === 'productModalPrimitives.tsx')[1];
  assert.match(shell, /event\.key === 'Escape' && !pending/);
  assert.match(shell, /event\.key === 'Tab'/);
  assert.match(shell, /previouslyFocused\?\.focus\(\)/);
  assert.match(shell, /useReducedMotion\(\)/);
});

test('the complete Contract Creation wizard uses the shared semantic and accessible interface', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;
  const inaccessibleClickTarget = /<(?:div|span|li)\b[^>]*\bonClick\s*=/;

  for (const [path, source] of contractWizardSources) {
    assert.match(source, /from '@\/components\/erp'/, `${path} must cross the canonical seam`);
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, inaccessibleClickTarget, `${path} must use semantic controls`);
    assert.doesNotMatch(source, /glass-liquid/, `${path} must not expose the legacy glass layer`);
  }

  const wizard = contractWizardSources.find(([path]) => path === 'CreateContractWizardClient.tsx')[1];
  const paymentDialog = contractWizardSources.find(([path]) => path === 'PaymentEntryModal.tsx')[1];
  const progress = contractWizardSources.find(([path]) => path === 'WizardProgressBar.tsx')[1];
  const navigation = contractWizardSources.find(([path]) => path === 'WizardNavigation.tsx')[1];

  assert.match(wizard, /<main className="sds-workspace/);
  assert.match(wizard, /contractSubmission\.isSubmitting/);
  assert.match(wizard, /editRecovery\.blocked/);
  assert.match(wizard, /inert: ''/);
  assert.match(wizard, /role="dialog"/);
  assert.match(wizard, /aria-modal="true"/);
  assert.match(wizard, /event\.key === 'Escape'/);
  assert.match(wizard, /event\.key === 'Tab'/);
  assert.match(wizard, /previouslyFocused\?\.focus\(\)/);
  assert.doesNotMatch(wizard, /مراحل ایجاد قرارداد را تکمیل کنید/u);
  assert.match(paymentDialog, /<CentralProductModalShell/);
  assert.match(progress, /aria-current=\{isActive \? 'step' : undefined\}/);
  assert.match(navigation, /aria-busy=\{loading\}/);
});

test('the application shell preserves shared behavior through canonical accessible surfaces', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|gray|green|indigo|neutral|orange|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;
  const inaccessibleClickTarget = /<(?:div|span|li)\b[^>]*\bonClick\s*=/;

  for (const [path, source] of dashboardShellSources) {
    assert.match(source, /from '@\/components\/erp'/, `${path} must cross the canonical seam`);
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, inaccessibleClickTarget, `${path} must use semantic controls`);
    assert.doesNotMatch(source, /glass-liquid-/, `${path} must not expose the legacy glass layer`);
  }
  const shell = dashboardShellSources[0][1];
  assert.match(shell, /mustChangePassword/);
  assert.match(shell, /authAPI\.logout/);
  assert.match(shell, /aria-label="بازکردن منوی اصلی"/);
  assert.match(shell, /event\.key === 'Escape'/);
});

test('shared formatted numeric entry consumes the canonical field primitive', () => {
  for (const [path, source] of sharedFieldSources) {
    assert.match(source, /from '@\/components\/erp'/, `${path} must cross the canonical seam`);
    assert.match(source, /<ErpInput/);
    assert.doesNotMatch(source, /<input\b/);
  }
});

test('CRM registry and pipeline routes use canonical controls without tutorial clutter', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;
  const inaccessibleClickTarget = /<(?:div|span|li)\b[^>]*\bonClick\s*=/;

  for (const [path, source] of crmSources) {
    assert.match(source, /from '@\/components\/erp'/, `${path} must cross the canonical seam`);
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, inaccessibleClickTarget, `${path} must use semantic controls`);
    assert.doesNotMatch(source, /glass-liquid|CrmGuide|data-crm-guide/, `${path} must omit legacy tutorials`);
  }
});

test('Sales management and interactive template surfaces use the shared semantic interface', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [path, source] of salesSources) {
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, /<div\b[^>]*\bonClick=/, `${path} must not use inaccessible clickable containers`);
  }
});

test('Inventory catalogs and Logistics operations consume canonical semantic controls', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [path, source] of inventoryLogisticsSources) {
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, /<div\b[^>]*\bonClick=/, `${path} must not use inaccessible clickable containers`);
  }
});

test('Accounting entry, review, and oversight surfaces use canonical semantic controls', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [path, source] of accountingSources) {
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, /<div\b[^>]*\bonClick=/, `${path} must not use inaccessible clickable containers`);
  }
});

test('People, applicant, permission, and administration surfaces use canonical semantic controls', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [path, source] of peopleAdministrationSources) {
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, /<div\b[^>]*\bonClick=/, `${path} must not use inaccessible clickable containers`);
  }
});

test('Guard daily operations do not reimplement palette or native-control presentation', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|gray|green|indigo|neutral|orange|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [name, source] of [
    ['Guard attendance', guardAttendanceSource],
    ['Guard vehicles', guardVehiclesSource]
  ]) {
    assert.doesNotMatch(source, hardcodedPalette, `${name} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${name} must consume canonical controls`);
    assert.match(source, /ErpWorkspacePage/);
    assert.match(source, /erpFieldLabelClassName/);
    assert.match(source, /ErpSkeleton/, `${name} must retain a loading state`);
    assert.match(source, /ErpInlineState/, `${name} must retain an error state`);
    assert.match(source, /ErpEmptyState/, `${name} must retain an empty state`);
  }
});

test('every Guard route consumes the shared semantic interface', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|gray|green|indigo|neutral|orange|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [path, source] of guardPageSources) {
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.match(source, /ErpWorkspacePage/, `${path} must use the shared workspace frame`);
  }
});

test('Guard dialogs and shared field widgets do not expose the legacy visual layer', () => {
  const hardcodedPalette =
    /\b(?:bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|gray|green|indigo|neutral|orange|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc|black|white)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-fA-F]{3,8}\b/;
  const rawControl = /<(?:button|input|select|textarea)\b/;

  for (const [path, source] of guardSupportingSources) {
    assert.doesNotMatch(source, hardcodedPalette, `${path} must use semantic meanings`);
    assert.doesNotMatch(source, rawControl, `${path} must consume canonical controls`);
    assert.doesNotMatch(source, /glass-liquid/, `${path} must not expose the old glass layer`);
    assert.match(source, /from '@\/components\/erp'/, `${path} must cross the canonical module seam`);
  }
});

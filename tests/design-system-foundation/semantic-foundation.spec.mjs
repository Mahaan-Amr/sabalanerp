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
const layoutSource = read('frontend/src/app/layout.tsx');
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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.resolve(__dirname, 'CreateContractWizardClient.tsx'),
  'utf8',
);
const start = source.indexOf('className="stair-v2-modal');
const end = source.indexOf('{/* Product Modal */}', start);
const stairModalSource = source.slice(start, end > start ? end : undefined);

assert.ok(start >= 0, 'stair modal source must be present');
assert.match(stairModalSource, /sds-neumorphic-workflow-scope/);
assert.doesNotMatch(
  stairModalSource,
  /dark:text-\[var\(--sds-text-inverse\)\]/,
  'dark stair fields must use the primary semantic text color',
);

console.log('Stair modal presentation tests passed.');

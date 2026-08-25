import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const editorSource = readFileSync(
  path.resolve(__dirname, 'WorkScheduleEditor.tsx'),
  'utf8',
);
const personnelSource = readFileSync(
  path.resolve(__dirname, '../app/dashboard/hr/personnel/page.tsx'),
  'utf8',
);

assert.match(editorSource, /sds-neumorphic-workflow-scope/);
assert.match(editorSource, /sds-neumorphic-card/);
assert.match(
  personnelSource,
  /panel === "schedule"[\s\S]*?presentation="modal"[\s\S]*?size="wide"/,
);

console.log('Work schedule modal presentation tests passed.');

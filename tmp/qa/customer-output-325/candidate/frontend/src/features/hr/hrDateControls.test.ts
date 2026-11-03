import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

const roots = [
  join(process.cwd(), 'src', 'app', 'dashboard', 'hr'),
  join(process.cwd(), 'src', 'features', 'hr'),
];

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(path);
  return ['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.endsWith('.test.ts') ? [path] : [];
});

test('HR date selection uses the shared Persian calendar instead of native date controls', () => {
  const violations = roots.flatMap(sourceFiles).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return /type=["'](?:date|datetime-local)["']/.test(source) ? [path] : [];
  });
  assert.deepEqual(violations, []);
});

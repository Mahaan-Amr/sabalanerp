import fs from 'fs';
import path from 'path';

const routesDir = path.join(__dirname, '..', 'src', 'routes');
const exemptFiles = new Set([
  'auth.ts',
  'users.ts',
  'permissions.ts',
  'workspace-permissions.ts'
]);

const routeStartRegex = /router\.(get|post|put|patch|delete)\(/;

const files = fs.readdirSync(routesDir).filter((file) => file.endsWith('.ts'));

const issues: { file: string; line: number; snippet: string }[] = [];

for (const file of files) {
  if (exemptFiles.has(file)) continue;

  const fullPath = path.join(routesDir, file);
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!routeStartRegex.test(line)) continue;

    const blockLines = [line];
    let j = i + 1;
    while (j < lines.length && blockLines.join('\n').indexOf(');') === -1 && j <= i + 12) {
      blockLines.push(lines[j]);
      j++;
    }

    const block = blockLines.join('\n');

    if (block.includes('feature-guard-exempt')) {
      continue;
    }

    const hasProtect = block.includes('protect');
    const hasFeatureGuard = block.includes('requireFeatureAccess');

    if (hasProtect && !hasFeatureGuard) {
      issues.push({
        file,
        line: i + 1,
        snippet: line.trim()
      });
    }
  }
}

if (issues.length > 0) {
  console.error('Missing feature guards on protected routes:');
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line} ${issue.snippet}`);
  }
  process.exit(1);
}

console.log('Feature guard coverage OK.');

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const TARGET_DIRS = ['frontend/src', 'backend/src', 'backend/prisma'];
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.prisma']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git']);

const mojibakeRegex = /[ØÙÛÃ]/;
const replacementRegex = /�/;
const questionRegex = /\?{2,}|؟{2,}/;

const records = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) {
      if (item.name !== '.prisma') continue;
    }
    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue;
      walk(path.join(dir, item.name));
      continue;
    }
    const ext = path.extname(item.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;
    scanFile(path.join(dir, item.name));
  }
}

function classify(lineText) {
  if (replacementRegex.test(lineText)) return 'replacement-char';
  if (mojibakeRegex.test(lineText)) return 'mojibake';
  if (questionRegex.test(lineText)) return 'question-marks';
  return '';
}

function confidenceFor(type) {
  if (type === 'mojibake') return 0.95;
  if (type === 'replacement-char') return 0.9;
  return 0.65;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const type = classify(line);
    if (!type) return;

    records.push({
      file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
      line: idx + 1,
      token: line.trim().slice(0, 180),
      class: type,
      confidence: confidenceFor(type)
    });
  });
}

for (const dir of TARGET_DIRS) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) walk(full);
}

const outDir = path.join(ROOT, 'reports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const jsonPath = path.join(outDir, 'text-corruption-inventory.json');
fs.writeFileSync(jsonPath, JSON.stringify(records, null, 2), 'utf8');

const csvHeader = 'file,line,class,confidence,token\n';
const csvBody = records
  .map((r) => {
    const token = `"${String(r.token).replace(/"/g, '""')}"`;
    return `${r.file},${r.line},${r.class},${r.confidence},${token}`;
  })
  .join('\n');

const csvPath = path.join(outDir, 'text-corruption-inventory.csv');
fs.writeFileSync(csvPath, csvHeader + csvBody + '\n', 'utf8');

const byClass = records.reduce((acc, r) => {
  acc[r.class] = (acc[r.class] || 0) + 1;
  return acc;
}, {});

console.log('Generated corruption inventory:');
console.log(`- JSON: ${path.relative(ROOT, jsonPath)}`);
console.log(`- CSV:  ${path.relative(ROOT, csvPath)}`);
console.log(`- Total records: ${records.length}`);
for (const [k, v] of Object.entries(byClass)) {
  console.log(`  - ${k}: ${v}`);
}

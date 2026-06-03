import fs from 'fs';
import path from 'path';

const MARKER_REGEX = /[ØÙÃÂâï�]/;
const SEGMENT_REGEX = /[ØÙÃÂâï�][^\u0600-\u06FF\s"'`<>]*[^\s"'`<>]*/g;

function decodeSegment(segment) {
  try {
    const decoded = Buffer.from(segment, 'latin1').toString('utf8');
    if (!decoded || decoded === segment) return segment;
    return decoded;
  } catch {
    return segment;
  }
}

function fixContent(content) {
  if (!MARKER_REGEX.test(content)) return { content, changed: false, replacements: 0 };

  let replacements = 0;
  const updated = content.replace(SEGMENT_REGEX, (segment) => {
    const decoded = decodeSegment(segment);
    if (decoded !== segment) {
      replacements += 1;
      return decoded;
    }
    return segment;
  });

  return {
    content: updated,
    changed: updated !== content,
    replacements
  };
}

function collectTargetFiles(inputPaths) {
  const files = [];

  for (const inputPath of inputPaths) {
    const resolved = path.resolve(process.cwd(), inputPath);
    if (!fs.existsSync(resolved)) continue;
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      files.push(resolved);
      continue;
    }
    if (stat.isDirectory()) {
      const stack = [resolved];
      while (stack.length) {
        const dir = stack.pop();
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) {
            if (item.name === 'node_modules' || item.name === '.next' || item.name === 'dist') continue;
            stack.push(full);
            continue;
          }
          if (!/\.(ts|tsx|js|jsx|md)$/i.test(item.name)) continue;
          files.push(full);
        }
      }
    }
  }

  return files;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const paths = args.filter((arg) => arg !== '--dry');

if (!paths.length) {
  console.error('Usage: node scripts/fix-mojibake.mjs [--dry] <file-or-dir> ...');
  process.exit(2);
}

const targets = collectTargetFiles(paths);
let changedFiles = 0;
let totalReplacements = 0;

for (const filePath of targets) {
  const original = fs.readFileSync(filePath, 'utf8');
  const { content, changed, replacements } = fixContent(original);
  if (!changed) continue;

  changedFiles += 1;
  totalReplacements += replacements;

  if (!dryRun) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

console.log(
  `${dryRun ? 'DRY' : 'APPLY'} fixed ${changedFiles} files with ${totalReplacements} replacements`
);


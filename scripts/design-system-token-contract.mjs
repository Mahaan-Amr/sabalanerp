import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.css', '.js', '.jsx', '.ts', '.tsx']);
const THEME_TOKEN_PREFIXES = [
  'sds-surface-',
  'sds-text-',
  'sds-border-',
  'sds-accent',
  'sds-focus-',
  'sds-success',
  'sds-warning',
  'sds-danger',
  'sds-info',
  'sds-purple'
];

const variablesIn = (source) => new Map(
  Array.from(
    source.matchAll(/--(sds-[\w-]+)\s*:\s*([^;]+);/g),
    (match) => [match[1], match[2].trim()]
  )
);

const themeBlock = (source, selector) => {
  const start = source.indexOf(selector);
  if (start < 0) return '';
  const openingBrace = source.indexOf('{', start + selector.length);
  if (openingBrace < 0) return '';
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  return '';
};

const isThemeToken = (token) => THEME_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));

export const validateSemanticTokenContract = ({ tokenSource, sources }) => {
  const diagnostics = [];
  const definitions = variablesIn(tokenSource);
  const lightDefinitions = variablesIn(themeBlock(tokenSource, '[data-theme="light"]'));
  const darkDefinitions = variablesIn(themeBlock(tokenSource, '[data-theme="dark"]'));

  for (const [file, source] of sources) {
    for (const match of source.matchAll(/var\(--(sds-[\w-]+)/g)) {
      if (!definitions.has(match[1])) {
        diagnostics.push({
          kind: 'undefined-reference',
          file,
          token: match[1],
          message: `${file} references undefined token --${match[1]}`
        });
      }
    }
  }

  for (const [token, value] of definitions) {
    for (const match of value.matchAll(/var\(--(sds-[\w-]+)/g)) {
      if (!definitions.has(match[1])) {
        diagnostics.push({
          kind: 'invalid-alias',
          file: 'frontend/src/styles/design-system-tokens.css',
          token,
          target: match[1],
          message: `--${token} aliases undefined token --${match[1]}`
        });
      }
    }
  }

  const themedTokens = new Set(
    [...lightDefinitions.keys(), ...darkDefinitions.keys()].filter(isThemeToken)
  );
  for (const token of themedTokens) {
    if (!lightDefinitions.has(token)) {
      diagnostics.push({
        kind: 'missing-theme-counterpart',
        theme: 'light',
        token,
        message: `light theme is missing --${token}`
      });
    }
    if (!darkDefinitions.has(token)) {
      diagnostics.push({
        kind: 'missing-theme-counterpart',
        theme: 'dark',
        token,
        message: `dark theme is missing --${token}`
      });
    }
  }

  return diagnostics;
};

export const readInteractiveSources = (root) => {
  const sourceRoot = path.join(root, 'frontend', 'src');
  const sources = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        sources.push([
          path.relative(root, absolutePath).replace(/\\/g, '/'),
          fs.readFileSync(absolutePath, 'utf8')
        ]);
      }
    }
  };
  visit(sourceRoot);
  return sources;
};

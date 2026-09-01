import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { repositoryRoot, interfaceVersion } from './safety.mjs';

async function listFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) files.push(...await listFiles(root, path.join(relative, entry.name)));
    else files.push(path.join(relative, entry.name));
  }
  return files.sort();
}

const routePath = (file) => `/${path.dirname(file).split(path.sep).filter((part) => part && part !== '.' && !part.startsWith('(')).join('/')}`;

export async function discoverPages(root) {
  return (await listFiles(root)).filter((file) => /^page\.(tsx|ts|jsx|js)$/.test(path.basename(file))).map(routePath).sort();
}

const responsibilities = {
  sales: ['Internal Seller', 'Sales manager', 'ADMIN'], crm: ['Internal Seller', 'CRM manager', 'ADMIN'],
  accounting: ['Accountant', 'Accounting manager', 'ADMIN'], hr: ['HR action holder', 'HR manager', 'ADMIN'],
  inventory: ['Inventory/Production operator', 'Inventory manager', 'ADMIN'], security: ['Guard', 'Guard supervisor', 'ADMIN'],
  logistics: ['Logistics operator', 'Logistics manager', 'ADMIN'], bi: ['Scoped reporting user', 'ADMIN'],
  admin: ['ADMIN', 'explicitly authorized manager'], personal: ['Authenticated User'],
  support: ['Reporter', 'Handler', 'Scoped support manager'], public: ['Anonymous customer/applicant'],
  core: ['Authenticated User', 'ADMIN'], inquiry: ['Inquiry user', 'Inquiry admin'],
};

export async function buildInventory() {
  const routes = [];
  const serverActions = [];
  for (const [app, folder] of [['erp', 'frontend/src/app'], ['inquiry', 'apps/sabalan-inquiry/app']]) {
    const files = await listFiles(path.join(repositoryRoot, folder));
    for (const file of files.filter((entry) => /^(page|route)\.(tsx|ts|jsx|js)$/.test(path.basename(entry)))) {
      const route = routePath(file);
      const kind = path.basename(file).startsWith('route.') ? 'http-handler' : 'page';
      const segment = route.split('/')[2];
      const workspace = app === 'inquiry' ? 'inquiry' : route.startsWith('/dashboard')
        ? (responsibilities[segment] ? segment : 'core') : 'public';
      const prototype = route.includes('prototype');
      routes.push({ app, route, kind, workspace, owner: `${workspace} acceptance owner (#335)`, roles: responsibilities[workspace],
        actions: ['navigate', 'permission/deep-link', 'primary workflow', 'keyboard/RTL/responsive'],
        status: prototype ? 'not-applicable' : 'blocked',
        reason: prototype ? 'Prototype route; not a production acceptance surface.' : 'Inventoried only; role-specific runtime acceptance not executed by #314.' });
    }
    for (const file of files.filter((entry) => /\.[tj]sx?$/.test(entry))) {
      const source = await readFile(path.join(repositoryRoot, folder, file), 'utf8');
      if (!/^\s*['"]use server['"];/.test(source)) continue;
      for (const [, name] of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
        serverActions.push({ action: `${app}:${file.replaceAll('\\', '/')}#${name}`, workspace: app === 'inquiry' ? 'inquiry' : 'core',
          roles: responsibilities[app === 'inquiry' ? 'inquiry' : 'core'], owner: `${app} server-action owner (#335)`, status: 'blocked',
          reason: 'Server action inventoried; authentication, authorization and persistence behavior not exercised by #314.' });
      }
    }
  }
  const source = await readFile(path.join(repositoryRoot, 'backend/src/middleware/feature.ts'), 'utf8');
  const constants = source.split('export const FEATURES = {')[1]?.split('} as const;')[0];
  if (!constants) throw new Error('Feature catalog shape changed; review inventory extraction.');
  const workspaceMap = source.split('export const FEATURE_WORKSPACE_MAP:')[1]?.split('\n};')[0] || '';
  const actions = [...constants.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map(([, key, action]) => {
    const workspace = workspaceMap.match(new RegExp(`\\[FEATURES\\.${key}\\]:\\s*'([^']+)'`))?.[1] || 'core';
    return { action, workspace, roles: responsibilities[workspace] || responsibilities.core,
      owner: `${workspace} acceptance owner (#335)`, status: 'blocked', reason: 'Permission definition inventoried; grant alone does not prove action or resource authorization.' };
  });
  // HR actions have a separate canonical catalog; retain every key instead of treating the legacy feature list as exhaustive.
  const hr = await readFile(path.join(repositoryRoot, 'backend/src/services/hrActionPermissionCatalog.ts'), 'utf8');
  for (const [, action] of hr.matchAll(/\{\s*code:\s*'([^']+)'[^\n]+level:/g)) {
    if (!actions.some((row) => row.action === action)) actions.push({ action, workspace: 'hr', roles: responsibilities.hr,
      owner: 'HR acceptance owner (#335)', status: 'blocked', reason: 'HR action catalog entry; role-specific behavioral acceptance outstanding.' });
  }
  const schema = await readFile(path.join(repositoryRoot, 'backend/prisma/schema.prisma'), 'utf8');
  const databaseRoles = schema.match(/enum UserRole\s*\{([^}]+)\}/)?.[1].trim().split(/\s+/);
  const content = { interfaceVersion, databaseRoles, responsibilities, routes, actions: [...actions, ...serverActions].sort((a, b) => a.action.localeCompare(b.action)) };
  return { ...content, inventoryHash: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
}

export function renderInventory(inventory) {
  return `# Partner acceptance route and action inventory\n\nGenerated by \`node scripts/run-partner-sales-tests.mjs inventory\`. Discovery is not acceptance.\n\nInterface: ${inventory.interfaceVersion}; inventory SHA-256: \`${inventory.inventoryHash}\`.\n\nDatabase roles: ${inventory.databaseRoles.join(', ')}. Business personas are scoped grants, not new database roles.\n\n## Routes (${inventory.routes.length})\n\n| App | Route | Workspace | Roles | Owner | Status | Reason |\n| --- | --- | --- | --- | --- | --- | --- |\n${inventory.routes.map((row) => `| ${row.app} | \`${row.route}\` | ${row.workspace} | ${row.roles.join(', ')} | ${row.owner} | ${row.status} | ${row.reason} |`).join('\n')}\n\nEvery route requires navigation, permission/deep-link, primary workflow, keyboard, RTL and responsive checks.\n\n## Actions (${inventory.actions.length})\n\n| Action | Workspace | Roles | Owner | Status | Reason |\n| --- | --- | --- | --- | --- | --- |\n${inventory.actions.map((row) => `| \`${row.action}\` | ${row.workspace} | ${row.roles.join(', ')} | ${row.owner} | ${row.status} | ${row.reason} |`).join('\n')}\n`;
}

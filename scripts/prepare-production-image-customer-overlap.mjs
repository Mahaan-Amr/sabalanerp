import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {};
function capture(name) {
  const bytes = fs.readFileSync(path.join(root, name)), hash = sha(bytes);
  if (sources[name]) assert.equal(sources[name], hash);
  sources[name] = hash; return bytes;
}
capture('scripts/prepare-production-image-customer-overlap.mjs');
capture('scripts/prepare-production-image-customer-remote.mjs');
capture('scripts/verify-production-image-customer-overlap.mjs');
const destination = path.join('D:/sabalanerp-online-qa', 'actual-image-customer-' + randomBytes(16).toString('hex'));
fs.mkdirSync(destination, { mode: 0o700 });
const require = createRequire(import.meta.url), esbuild = require('../backend/node_modules/esbuild');
const bundles = {};
async function bundle(input, output) {
  const result = await esbuild.build({ absWorkingDir: root, stdin: { contents: input, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', target: 'node22', write: false,
    metafile: true, logLevel: 'silent', plugins: [{ name: 'captured-source', setup(builder) {
      // The current fixture's workspace packages belong to its captured source
      // closure. Keep them out of the historical image's package resolution.
      builder.onResolve({ filter: /^@sabalanerp\// }, args => {
        const resolved = fs.realpathSync(require.resolve(args.path, { paths: [path.join(root, 'backend')] }));
        assert.ok(resolved.startsWith(path.join(root, 'packages') + path.sep));
        return { path: resolved };
      });
      builder.onLoad({ filter: /.*/, namespace: 'file' }, args => {
        const name = path.relative(root, args.path).split(path.sep).join('/');
        assert.ok(name && !name.startsWith('../') && !path.isAbsolute(name));
        const bytes = capture(name), loader = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.json': 'json' }[path.extname(args.path)];
        assert.ok(loader); return { contents: bytes, loader, resolveDir: path.dirname(args.path) };
      });
    } }] });
  for (const name of Object.keys(result.metafile.inputs)) if (name !== '<stdin>') assert.ok(sources[name]);
  const bytes = result.outputFiles[0].contents;
  fs.writeFileSync(path.join(destination, output), bytes, { flag: 'wx', mode: 0o400 });
  bundles[output] = { input, sha256: sha(bytes) };
}
await bundle(`export { customerFinanceData } from './backend/src/services/__tests__/customerFinanceFixture';
export { disconnectDatabase } from './backend/src/lib/prisma';`, 'qa-fixture.cjs');
await bundle(`export { compileActualImageClosedCustomerExpansion } from './backend/src/services/closedCustomerExpansion';`, 'compiler.cjs');
const { compileActualImageClosedCustomerExpansion } = require(path.join(destination, 'compiler.cjs'));
const names = ['20261014150000_customer_opening_review', '20261014151000_customer_credit_settlement_source',
  '20261014152000_customer_receipt_components', '20261014153000_customer_receipt_adjustments',
  '20261014154000_customer_check_bank_outcomes', '20261014155000_customer_command_and_attribution',
  '20261014160000_customer_legacy_receipt_resolution', '20261019010000_customer_semantic_barrier'];
const program = compileActualImageClosedCustomerExpansion(names.map(name => ({ name, bytes: capture(`backend/prisma/migrations/${name}/migration.sql`) })));
const files = {};
function save(name, bytes) {
  fs.writeFileSync(path.join(destination, name), bytes, { flag: 'wx', mode: 0o400 });
  files[name] = { sha256: sha(bytes), bytes: bytes.length };
}
save('qa-financial.sql', Buffer.from(program.sql));
save('qa-overlap.cjs', capture('tests/online-deployment/production-image-customer-overlap.fixture.cjs'));
files['qa-fixture.cjs'] = { sha256: bundles['qa-fixture.cjs'].sha256, bytes: fs.statSync(path.join(destination, 'qa-fixture.cjs')).size };
const infrastructure = [
  ['20261014120000_hr_vehicle_assignment_plans', 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289'],
  ['20261014140000_online_deployment_control', '872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2']
];
// These are fixture-native receipts in an independently restored private copy.
// They provide no protected bridge/history-adoption authority.
let sql = `DO $private_infrastructure_fixture$
BEGIN
  PERFORM set_config('TimeZone','UTC',true);
  PERFORM set_config('DateStyle','ISO, YMD',true);
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
  IF current_database() !~ '^qa_customer_expansion_[a-f0-9]{32}$'
    OR (SELECT count(*) FROM public._prisma_migrations) <> 426
    OR (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 425
    OR (SELECT count(*) FROM public._prisma_migrations m WHERE finished_at IS NULL AND rolled_back_at IS NOT NULL
      AND encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')='7e095386a618dda9ac3d2491772f5c473e91dc97fe4f12eb19a1b0004addefe2') <> 1
    OR (SELECT md5(string_agg(migration_name||':'||checksum,E'\\n' ORDER BY migration_name COLLATE "C"))
      FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 'e47df486d5c205d3bc44cb782dfbf09d' THEN
    RAISE EXCEPTION 'ACTUAL_IMAGE_PRIVATE_PREDECESSOR_UNPROVEN' USING ERRCODE='55000';
  END IF;
`;
for (const [name, expected] of infrastructure) {
  const bytes = capture(`backend/prisma/migrations/${name}/migration.sql`); assert.equal(sha(bytes), expected);
  assert.ok(!bytes.includes(Buffer.from('$private_infra_sql$')));
  sql += `EXECUTE $private_infra_sql$${bytes.toString()}$private_infra_sql$;\n`;
  sql += `INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,logs,started_at,applied_steps_count)
    VALUES(md5('actual-image-private-fixture:${name}'),'${expected}',clock_timestamp(),'${name}',
    '{"format":"sabalan-actual-image-infrastructure-fixture/v1","productionAdmission":false}',statement_timestamp(),1);\n`;
}
sql += 'END\n$private_infrastructure_fixture$;\n';
save('qa-infrastructure.sql', Buffer.from(sql));
save('restore.sh', Buffer.from(capture('tests/online-deployment/production-image-customer-postgres.fixture.sh').toString().replace(/\r\n/g, '\n')));
save('retire.py', capture('tests/online-deployment/production-image-customer-retire.fixture.py'));
save('closed_process_references.py', capture('deploy/scripts/closed-derived-process-references.py'));
const mountGuard = fs.readFileSync('D:/sabalanerp-online-qa/closed-base-mount-guard-20261018.py');
assert.equal(sha(mountGuard), '165101a51ecc00db4b12ff65a5b2fe55f7037b4407ccdde5e799afa7bda54cd7');
save('mount_guard.py', mountGuard);
const controller = capture('tests/online-deployment/production-image-customer-owner.fixture.py');
fs.writeFileSync(path.join(destination, 'controller.py'), controller, { flag: 'wx', mode: 0o400 });
for (const [name, hash] of Object.entries(sources)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
const manifest = { format: 'sabalan-actual-image-customer-input/v1', productionAdmission: false, destination, sources, bundles, files,
  controller: { sha256: sha(controller), bytes: controller.length } };
const manifestPath = path.join(destination, 'input-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
console.log(JSON.stringify({ manifestPath, manifestSha256: sha(fs.readFileSync(manifestPath)), sources: Object.keys(sources).length }));

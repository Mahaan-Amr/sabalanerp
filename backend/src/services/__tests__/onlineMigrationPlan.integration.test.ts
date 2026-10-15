import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { applyOnlineExpansion, backfillMirroredColumn, compileOnlineExpansion, mirroredBackfillOperationSha256,
  type OnlineExpansionPlan, type MirroredBackfillPlan } from '../onlineMigrationPlan';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const plan: OnlineExpansionPlan = { format: 'sabalan-online-expansion/v1', migrationName: '20261014150000_qa_online_mirror',
  operations: [{ kind: 'mirror-column', table: 'online_migration_probe', column: 'amount_v2', sourceColumn: 'amount', type: 'numeric(24,8)' }] };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(complete => { resolve = complete; }); return { promise, resolve }; };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

test('online expansion accepts only exact generated additive SQL and rejects unsupported semantics', () => {
  const compiled = compileOnlineExpansion(plan);
  assert.equal(compiled.sqlSha256.length, 64);
  for (const operation of [
    { kind: 'drop-column', table: 'sales_contracts', column: 'amount' },
    { ...plan.operations[0], table: 'probe; DROP TABLE contracts' },
    { ...plan.operations[0], type: 'numeric(24,8); DELETE FROM users' },
    { ...plan.operations[0], column: 'amount' },
    { ...plan.operations[0], default: '0' },
  ]) assert.throws(() => compileOnlineExpansion({ ...plan, operations: [operation as any] }));
  assert.throws(() => compileOnlineExpansion({ ...plan, operations: [...plan.operations, ...plan.operations] }), /DUPLICATE_COLUMN/);
  assert.throws(() => compileOnlineExpansion({ ...plan, operations: [...plan.operations,
    { ...plan.operations[0], column: 'amount_v3' }] }), /MIRROR_OVERLAP/);
  assert.throws(() => compileOnlineExpansion({ ...plan, operations: [...plan.operations,
    { kind: 'add-nullable-column', table: 'online_migration_probe', column: 'amount', type: 'numeric(24,8)' }] }), /MIRROR_OVERLAP/);
});

test('real-schema bounded expansion, atomic history, concurrent old/new writers and restartable mirror backfill preserve acknowledged values',
  { skip: !process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL, timeout: 240_000 }, async () => {
    const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
      sourceDatabaseUrl: process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL!, migrateEmptySchema: true });
    const database = temporary.client(), oldWriter = temporary.client(), newWriter = temporary.client(), blocker = temporary.client();
    const blocked = deferred(), unblock = deferred();
    let holding: Promise<unknown> | undefined;
    let nativeRoot: string | undefined;
    const owner = { deploymentId: 'qa-online-owner', leaseToken: 'qa-online-lease-token', releaseId: 'qa-online-release' };
    const compiled = compileOnlineExpansion(plan);
    const sql = Buffer.from(compiled.sql);
    try {
      await database.deploymentOperation.create({ data: { id: owner.deploymentId, activeKey: 'production', leaseToken: owner.leaseToken,
        releaseId: owner.releaseId, targetCommit: 'a'.repeat(40), owner: 'isolated-online-migration-qa', phase: 'LEASE_ACQUIRED',
        leaseExpiresAt: new Date(Date.now() + 600_000), heartbeatAt: new Date(), startedAt: new Date() } });
      await database.onlineRelease.create({ data: { id: owner.releaseId, deploymentId: owner.deploymentId, manifestSha256: 'b'.repeat(64),
        sourceCommit: 'a'.repeat(40), identityJson: {}, compatibilityJson: {}, recoveryJson: {}, phase: 'EXPANDING' } });
      await database.$executeRawUnsafe('CREATE TABLE online_migration_probe (id text PRIMARY KEY, amount numeric(24,8) NOT NULL)');
      await database.$executeRawUnsafe(`INSERT INTO online_migration_probe SELECT 'seed-' || lpad(i::text, 5, '0'), 10.25 FROM generate_series(1,100) AS i`);
      await database.onlineMigrationStep.create({ data: { id: 'qa-expand', releaseId: owner.releaseId, stepId: plan.migrationName,
        phase: 'expand', operationSha256: compiled.operationSha256, operationJson: asJson(compiled.plan), sourceMigrationName: plan.migrationName } });
      await assert.rejects(() => applyOnlineExpansion(database, { ...owner, leaseToken: 'wrong-owner' }, plan, sql), /LEASE_LOST/);
      await assert.rejects(() => applyOnlineExpansion(database, owner, plan, Buffer.concat([sql, Buffer.from('DROP TABLE online_migration_probe;')])), /SQL_IDENTITY_MISMATCH/);
      holding = blocker.$transaction(async tx => {
        await tx.$executeRawUnsafe('LOCK TABLE online_migration_probe IN ACCESS SHARE MODE'); blocked.resolve(); await unblock.promise;
      }, { timeout: 30_000 });
      await blocked.promise;
      const lockStarted = Date.now();
      await assert.rejects(() => applyOnlineExpansion(database, owner, plan, sql), /lock timeout/);
      assert.ok(Date.now() - lockStarted < 5000, 'an old reader cannot create an unbounded schema wait');
      assert.equal(await database.onlineMigrationStep.count({ where: { state: 'PENDING' } }), 1);
      assert.deepEqual(await database.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='online_migration_probe' AND column_name='amount_v2'`), []);
      unblock.resolve(); await holding; holding = undefined;
      assert.equal((await applyOnlineExpansion(database, owner, plan, sql)).applied, true);
      assert.equal((await applyOnlineExpansion(database, owner, plan, sql)).applied, false);
      await assert.rejects(() => newWriter.$executeRawUnsafe("UPDATE online_migration_probe SET amount_v2=NULL WHERE id='seed-00001'"), /ONLINE_MIRROR_NULL_UNSUPPORTED/);
      assert.deepEqual(await database.$queryRawUnsafe("SELECT amount::text,amount_v2 FROM online_migration_probe WHERE id='seed-00001'"), [{ amount:'10.25000000', amount_v2:null }]);
      // A later release cannot silently add a second independently ordered
      // mirror or bypass legacy UPDATE OF domain triggers.
      const laterPlan: OnlineExpansionPlan = { ...plan, migrationName:'20261014150002_qa_later_mirror',
        operations:[{ ...plan.operations[0], column:'amount_v3' }] };
      const later = compileOnlineExpansion(laterPlan);
      await database.onlineMigrationStep.create({data:{id:'qa-later',releaseId:owner.releaseId,stepId:laterPlan.migrationName,
        phase:'expand',operationSha256:later.operationSha256,operationJson:asJson(later.plan),sourceMigrationName:laterPlan.migrationName}});
      await assert.rejects(()=>applyOnlineExpansion(database,owner,laterPlan,Buffer.from(later.sql)),/EXISTING_TRIGGER_UNPROVEN/);
      await database.$executeRawUnsafe('CREATE TABLE online_nullable_probe (id text PRIMARY KEY, amount numeric(24,8))');
      const nullablePlan: OnlineExpansionPlan = {...plan,migrationName:'20261014150003_qa_nullable_mirror',
        operations:[{...plan.operations[0],table:'online_nullable_probe'}]};
      const nullable=compileOnlineExpansion(nullablePlan);
      await database.onlineMigrationStep.create({data:{id:'qa-nullable',releaseId:owner.releaseId,stepId:nullablePlan.migrationName,
        phase:'expand',operationSha256:nullable.operationSha256,operationJson:asJson(nullable.plan),sourceMigrationName:nullablePlan.migrationName}});
      await assert.rejects(()=>applyOnlineExpansion(database,owner,nullablePlan,Buffer.from(nullable.sql)),/SOURCE_TYPE_MISMATCH/);
      await assert.rejects(()=>database.onlineMigrationStep.delete({where:{id:'qa-later'}}),/HISTORY_CANNOT_BE_DELETED/);
      await assert.rejects(()=>database.$executeRawUnsafe('TRUNCATE online_migration_steps'),/HISTORY_CANNOT_BE_DELETED/);
      assert.equal((await database.$queryRawUnsafe<Array<{ total: string }>>('SELECT sum(amount)::text AS total FROM online_migration_probe'))[0].total, '1025.00000000');
      await database.$executeRawUnsafe('CREATE TABLE online_interruption_probe (id text PRIMARY KEY)');
      const interruptedPlan: OnlineExpansionPlan = { format: 'sabalan-online-expansion/v1', migrationName: '20261014150001_qa_online_interruption',
        operations: [{ kind: 'add-nullable-column', table: 'online_interruption_probe', column: 'interrupted_column', type: 'text' }] };
      const interrupted = compileOnlineExpansion(interruptedPlan);
      await database.onlineMigrationStep.create({ data: { id: 'qa-interrupted', releaseId: owner.releaseId, stepId: interruptedPlan.migrationName,
        phase: 'expand', operationSha256: interrupted.operationSha256, operationJson: asJson(interrupted.plan), sourceMigrationName: interruptedPlan.migrationName } });
      await database.$executeRawUnsafe(`CREATE FUNCTION qa_expire_online_owner() RETURNS event_trigger AS $$ BEGIN
        UPDATE deployment_operations SET "leaseExpiresAt"=clock_timestamp() WHERE id='qa-online-owner'; END; $$ LANGUAGE plpgsql`);
      await database.$executeRawUnsafe(`CREATE EVENT TRIGGER qa_expire_online_owner ON ddl_command_end WHEN TAG IN ('ALTER TABLE')
        EXECUTE FUNCTION qa_expire_online_owner()`);
      try {
        await assert.rejects(() => applyOnlineExpansion(database, owner, interruptedPlan, Buffer.from(interrupted.sql)), /LEASE_LOST/);
        assert.deepEqual(await database.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='online_interruption_probe' AND column_name='interrupted_column'`), []);
        assert.deepEqual(await database.$queryRawUnsafe(`SELECT id FROM _prisma_migrations WHERE migration_name='20261014150001_qa_online_interruption'`), []);
        assert.equal((await database.onlineMigrationStep.findUniqueOrThrow({ where: { id: 'qa-interrupted' } })).state, 'PENDING');
      } finally {
        await database.$executeRawUnsafe('DROP EVENT TRIGGER qa_expire_online_owner');
        await database.$executeRawUnsafe('DROP FUNCTION qa_expire_online_owner()');
      }
      await database.$executeRawUnsafe(`CREATE FUNCTION qa_reject_online_completion() RETURNS trigger AS $$ BEGIN
        IF NEW.id='qa-interrupted' AND NEW.state='COMPLETE' THEN RAISE EXCEPTION 'injected online ledger failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
      await database.$executeRawUnsafe(`CREATE TRIGGER qa_reject_online_completion BEFORE UPDATE ON online_migration_steps
        FOR EACH ROW EXECUTE FUNCTION qa_reject_online_completion()`);
      try {
        await assert.rejects(() => applyOnlineExpansion(database, owner, interruptedPlan, Buffer.from(interrupted.sql)), /injected online ledger failure/);
        assert.deepEqual(await database.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='online_interruption_probe' AND column_name='interrupted_column'`), []);
        assert.deepEqual(await database.$queryRawUnsafe(`SELECT id FROM _prisma_migrations WHERE migration_name='20261014150001_qa_online_interruption'`), []);
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER qa_reject_online_completion ON online_migration_steps');
        await database.$executeRawUnsafe('DROP FUNCTION qa_reject_online_completion()');
      }
      const migrationBlocked=deferred(), migrationUnblock=deferred();
      holding=blocker.$transaction(async tx=>{
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(741936427::bigint)::text');
        migrationBlocked.resolve(); await migrationUnblock.promise;
      },{timeout:30_000});
      await migrationBlocked.promise;
      await database.$executeRawUnsafe(`CREATE FUNCTION qa_wait_online_ddl() RETURNS event_trigger AS $$ BEGIN
        PERFORM pg_advisory_xact_lock(741936427::bigint); END; $$ LANGUAGE plpgsql`);
      await database.$executeRawUnsafe(`CREATE EVENT TRIGGER qa_wait_online_ddl ON ddl_command_end WHEN TAG IN ('ALTER TABLE')
        EXECUTE FUNCTION qa_wait_online_ddl()`);
      const applying=applyOnlineExpansion(database,owner,interruptedPlan,Buffer.from(interrupted.sql));
      try {
        let waiting=false;
        for(let attempt=0;attempt<100;attempt++) {
          const rows=await oldWriter.$queryRawUnsafe<Array<{waiting:boolean}>>(`SELECT EXISTS(
            SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=741936427 AND NOT granted) AS waiting`);
          if(rows[0].waiting){waiting=true;break;} await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(waiting,true,'the real DDL must reach its post-alter barrier');
        await assert.rejects(()=>newWriter.$transaction(async tx=>{
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout='150ms'");
          await tx.onlineRelease.update({where:{id:owner.releaseId},data:{phase:'FAILED'}});
        }),/lock timeout/);
      } finally {
        migrationUnblock.resolve(); await holding; holding=undefined;
        await applying;
        await database.$executeRawUnsafe('DROP EVENT TRIGGER qa_wait_online_ddl');
        await database.$executeRawUnsafe('DROP FUNCTION qa_wait_online_ddl()');
      }
      nativeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-online-native-'));
      await fs.cp(path.resolve('prisma'), path.join(nativeRoot, 'prisma'), { recursive: true });
      await fs.mkdir(path.join(nativeRoot, 'prisma/migrations', plan.migrationName));
      await fs.writeFile(path.join(nativeRoot, 'prisma/migrations', plan.migrationName, 'migration.sql'), sql);
      await fs.mkdir(path.join(nativeRoot, 'prisma/migrations', interruptedPlan.migrationName));
      await fs.writeFile(path.join(nativeRoot, 'prisma/migrations', interruptedPlan.migrationName, 'migration.sql'), interrupted.sql);
      const native = execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema',
        path.join(nativeRoot, 'prisma/schema.prisma')], { env: { ...process.env, DATABASE_URL: temporary.databaseUrl },
        encoding: 'utf8', stdio: 'pipe', timeout: 60_000 });
      assert.match(native, /No pending migrations/);
      const backfill: MirroredBackfillPlan = { format: 'sabalan-mirror-backfill/v1', expansionMigrationName: plan.migrationName,
        operation: plan.operations[0] as any };
      await database.onlineMigrationStep.create({ data: { id: 'qa-backfill', releaseId: owner.releaseId, stepId: 'mirror-backfill',
        phase: 'backfill', operationSha256: mirroredBackfillOperationSha256(backfill), operationJson: asJson(backfill) } });
      await database.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: 'BACKFILLING' } });
      const rowBlocked = deferred(), rowUnblock = deferred();
      holding = blocker.$transaction(async tx => {
        await tx.$queryRawUnsafe("SELECT id FROM online_migration_probe WHERE id='seed-00001' FOR UPDATE");
        rowBlocked.resolve(); await rowUnblock.promise;
      }, { timeout: 30_000 });
      await rowBlocked.promise;
      try {
        await Promise.all([
          (async () => { for (let i = 20; i < 40; i++) await oldWriter.$executeRaw`UPDATE online_migration_probe SET amount=amount+0.25 WHERE id=${`seed-${String(i).padStart(5, '0')}`}`;
            await oldWriter.$executeRawUnsafe("INSERT INTO online_migration_probe(id,amount) VALUES ('old-insert',10.125)"); })(),
          (async () => { for (let i = 60; i < 80; i++) await newWriter.$executeRaw`UPDATE online_migration_probe SET amount_v2=coalesce(amount_v2,amount)+0.5 WHERE id=${`seed-${String(i).padStart(5, '0')}`}`;
            await newWriter.$executeRawUnsafe("INSERT INTO online_migration_probe(id,amount_v2) VALUES ('new-insert',11.875)"); })(),
          (async () => {
            for (let i = 0; i < 30; i++) {
              const result = await backfillMirroredColumn(database, owner, 'mirror-backfill', backfill, 7);
              assert.equal(result.complete, false, 'a skipped locked historical row must still prevent activation');
              if (result.updated === 0) break;
            }
          })(),
        ]);
        const progress = await database.onlineMigrationStep.findUniqueOrThrow({ where: { id: 'qa-backfill' } });
        assert.equal(progress.state, 'RUNNING');
        assert.ok(Number((progress.progressJson as any).updatedRows) > 0);
      } finally { rowUnblock.resolve(); await holding; holding = undefined; }
      // A new invocation resumes durable work without an in-memory cursor.
      let complete = false;
      for (let i = 0; i < 30 && !complete; i++) complete = (await backfillMirroredColumn(database, owner, 'mirror-backfill', backfill, 7)).complete;
      assert.equal(complete, true);
      const mirrorTrigger = `online_mirror_${require('node:crypto').createHash('sha256').update(`${plan.migrationName}:online_migration_probe:amount_v2`).digest('hex').slice(0,24)}`;
      await database.$executeRawUnsafe(`ALTER TABLE online_migration_probe DISABLE TRIGGER "${mirrorTrigger}"`);
      try { await assert.rejects(() => backfillMirroredColumn(database, owner, 'mirror-backfill', backfill, 7), /MIRROR_DRIFT/); }
      finally { await database.$executeRawUnsafe(`ALTER TABLE online_migration_probe ENABLE TRIGGER "${mirrorTrigger}"`); }
      await database.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: 'EXPANDING' } });
      await database.$executeRawUnsafe('ALTER TABLE online_migration_probe ALTER COLUMN amount_v2 SET DEFAULT 0');
      try { await assert.rejects(() => applyOnlineExpansion(database, owner, plan, sql), /SCHEMA_DRIFT/); }
      finally { await database.$executeRawUnsafe('ALTER TABLE online_migration_probe ALTER COLUMN amount_v2 DROP DEFAULT'); }
      await database.$executeRawUnsafe(`ALTER FUNCTION "${mirrorTrigger}"() SECURITY DEFINER`);
      try { await assert.rejects(() => applyOnlineExpansion(database, owner, plan, sql), /MIRROR_DRIFT/); }
      finally { await database.$executeRawUnsafe(`ALTER FUNCTION "${mirrorTrigger}"() SECURITY INVOKER`); }
      await database.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: 'BACKFILLING' } });
      assert.deepEqual(await backfillMirroredColumn(database, owner, 'mirror-backfill', backfill, 7), { updated: 0, complete: true });
      assert.deepEqual(await database.$queryRawUnsafe('SELECT id FROM online_migration_probe WHERE amount IS DISTINCT FROM amount_v2'), []);
      const total = (await database.$queryRawUnsafe<Array<{ old: string; next: string }>>('SELECT sum(amount)::text AS old, sum(amount_v2)::text AS next FROM online_migration_probe'))[0];
      assert.deepEqual(total, { old: '1062.00000000', next: '1062.00000000' });
      await assert.rejects(() => oldWriter.$executeRawUnsafe("UPDATE online_migration_probe SET amount=1,amount_v2=2 WHERE id='seed-00001'"), /ONLINE_MIRROR_CONFLICT/);
      await assert.rejects(() => database.onlineMigrationStep.update({ where: { id: 'qa-backfill' }, data: { state: 'PENDING' } }), /ONLINE_COMPLETED_MIGRATION_IMMUTABLE/);
      await assert.rejects(() => database.onlineRelease.update({ where: { id: owner.releaseId }, data: { manifestSha256: 'c'.repeat(64) } }), /ONLINE_RELEASE_IDENTITY_IMMUTABLE/);
      const retired = new Date(), until = new Date(retired.getTime() + 86_400_000);
      await assert.rejects(() => database.onlineRelease.update({ where: { id: owner.releaseId }, data: { retiredAt: retired,
        browserSupportUntil: new Date(retired.getTime() + 23 * 3_600_000) } }), /online_release_browser_window/);
      await database.onlineRelease.update({ where: { id: owner.releaseId }, data: { retiredAt: retired, browserSupportUntil: until } });
      await assert.rejects(() => database.onlineRelease.update({ where: { id: owner.releaseId }, data: { browserSupportUntil: null } }), /ONLINE_BROWSER_SUPPORT_CANNOT_SHRINK/);
      await assert.rejects(() => database.onlineRelease.update({ where: { id: owner.releaseId }, data: { retiredAt: new Date(retired.getTime() - 1000) } }), /ONLINE_RELEASE_RETIREMENT_IMMUTABLE/);
      await database.onlineRuntimeSlot.create({ data: { id: 'qa-slot', releaseId: owner.releaseId, component: 'backend', role: 'candidate',
        nonceSha256: 'd'.repeat(64), imageIdentity: `sha256:${'e'.repeat(64)}` } });
      await assert.rejects(() => database.onlineRuntimeSlot.update({ where: { id: 'qa-slot' }, data: { role: 'control' } }), /ONLINE_RUNTIME_IDENTITY_IMMUTABLE/);
      await assert.rejects(() => database.onlineRuntimeSlot.update({ where: { id: 'qa-slot' }, data: { phase: 'STOPPED' } }), /online_runtime_stopped_evidence/);
      await database.onlineRuntimeSlot.update({ where: { id: 'qa-slot' }, data: { phase: 'STOPPED', stoppedAt: new Date() } });
      await assert.rejects(() => database.onlineRuntimeSlot.update({ where: { id: 'qa-slot' }, data: { phase: 'READY', stoppedAt: null } }), /ONLINE_STOPPED_RUNTIME_CANNOT_RESTART/);
      await assert.rejects(()=>database.onlineRuntimeSlot.delete({where:{id:'qa-slot'}}),/HISTORY_CANNOT_BE_DELETED/);
      await assert.rejects(()=>database.onlineMigrationStep.delete({where:{id:'qa-backfill'}}),/HISTORY_CANNOT_BE_DELETED/);
      await database.onlineRelease.create({data:{id:'qa-empty-release',deploymentId:await (async()=>{
        const d=await database.deploymentOperation.create({data:{id:'qa-empty-operation',leaseToken:'empty-operation-token',releaseId:'qa-empty-release',
          targetCommit:'a'.repeat(40),owner:'qa',phase:'COMPLETED',leaseExpiresAt:new Date(),heartbeatAt:new Date(),startedAt:new Date()}});return d.id;
      })(),manifestSha256:'f'.repeat(64),sourceCommit:'a'.repeat(40),identityJson:{},compatibilityJson:{},recoveryJson:{}}});
      await assert.rejects(()=>database.onlineRelease.delete({where:{id:'qa-empty-release'}}),/HISTORY_CANNOT_BE_DELETED/);
    } finally {
      unblock.resolve(); if (holding) await holding.catch(() => undefined);
      await Promise.all([database.$disconnect(), oldWriter.$disconnect(), newWriter.$disconnect(), blocker.$disconnect()]);
      await temporary.cleanup();
      if (nativeRoot) {
        assert.equal(path.dirname(path.resolve(nativeRoot)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(nativeRoot).startsWith('sabalan-online-native-'));
        await fs.rm(nativeRoot, { recursive: true, force: true });
      }
    }
  });

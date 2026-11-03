/** Test-only owned sequence; no storage, DB or Docker operation occurs on import. */
async function runOwnedSequence(ops){
 await ops.preflight();
 const name=await ops.consume();await ops.marker('INTENT_CONSUMED');
 const created=await ops.create(name);if(created.state!=='SUCCESS')throw Error('CREATE_UNKNOWN');await ops.marker('DATABASE_CREATED');
 const beforeId=await ops.identity(name);if(beforeId.state!=='SUCCESS')throw Error('IDENTITY_UNKNOWN');await ops.marker('DATABASE_IDENTITY_OBSERVED');
 const setup=await ops.setup(name);if(setup.state!=='SUCCESS'||setup.value!=='SUCCESS')throw Error('SETUP_UNKNOWN');await ops.marker('BASELINE_COMPLETE');
 const seed=await ops.seed(name,beforeId.value);if(seed.state!=='SUCCESS')throw Error('OWNER_SEED_UNKNOWN');await ops.marker('OWNER_SEEDED');
 const before=await ops.before(name,beforeId.value);await ops.marker('BEFORE_OBSERVED');
 await ops.execute(name);await ops.marker('ACTUAL_CLI_CLOSED');
 const after=await ops.after(name,beforeId.value,before);await ops.marker('AFTER_OBSERVED');
 const afterId=await ops.identity(name);if(afterId.state!=='SUCCESS'||afterId.value!==beforeId.value)throw Error('IDENTITY_CHANGED');
 const census=await ops.census(name);if(census.state!=='SUCCESS'||census.value.sessions!==0||census.value.prepared!==0)throw Error('CENSUS_UNPROVEN');
 await ops.retained({name,identity:beforeId.value,before,after,census:census.value});return 'OBSERVED_RETAINED';
}
module.exports={runOwnedSequence};
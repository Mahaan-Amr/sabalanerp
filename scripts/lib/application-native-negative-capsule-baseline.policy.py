"""Literal C29 negative recovery proof. This never grants native qualification.

The failed original child stays code 1. The original master stays externally
cancelled code 125. Historical functions are loaded only from authenticated
immutable sources; their read-only predicates retain the original evidence graph.
"""
import base64
import hashlib
import json
import pathlib
import stat
import sys
import types

Q = pathlib.Path('D:/sabalanerp-online-qa')
ACTUAL = Q / 'C27-negative-prehello-context-actual-20261024/C29-post-up-negative-resume-actual-r1-20261024'
HANDOFF_SHA = '6543f4851d2076af49aaf20ee4238a2935cb615fa143e45bc7a0593ae3f12edd'
SOURCE_COMMIT = '45cab522a285b878b60f537d09d0962912bba096'
NONCE = '32c29444431a4f98bc6070f4182e7bb8'
SUBPATH = 'c16-recovery-70360dba0eb244dc91cdfcd0533315f9/c16-recovery-' + NONCE
ROOT = '/app/online-runtime-acceptance/application-native-04925e2e27368c1238bd2a563cc61c23'
FORMAT = 'sabalan-C29-verified-negative-predecessor/v1'
POLICY = {'file': str(Q / 'C29-finite-negative-recovery-source-r2-private-output-20261024/policy.py'),
          'sha256': 'da83b063197eb8e12854e6c9015dacf8289c594c512bcd895e1a5e7a26f60f81'}
PREFIX = {'file': str(Q / 'C29-post-up-failed-prefix-source-r1-20261024/prefix.py'),
          'sha256': '073a2b6b8a519a4f39ba32554f335f07fb997f11f857f90fda9a1c1286752d2e'}
PREFIX_PINS = {'file': str(Q / 'C29-post-up-failed-prefix-source-r1-20261024/pins.json'),
               'sha256': 'bfa4afb6c2cd5a234c683a590b7a4e7a515e9f599a4f08725ea10b102e1b15d4'}
RESUME = {'file': str(Q / 'C29-post-up-negative-resume-source-r2-buffer-20261024/resume_owner.py'),
          'sha256': '2a04b129d9a605f11b2592c9f09a2b775dd189543b4baa3648d7d9e9150fc061'}
REVIEW = {'file': str(Q / 'C29-actual-post-up-negative-restoration-independent-review-20261024.json'),
          'sha256': '86e1f3e9c6a861db40958d9c81b731b3295800ecd4ec56aaa4e5b58c277617b1'}
EXPECTED_ARGV_SHA = {'1-original-supervisor-absent.json': '35d6741a6b0e0e6be1a26888093e91435fee365e48d35829ea8430728075d5ef',
 '10-canonical-capsule-spec.json': '506d6ca41e58bb18b3ad089418f3a39ae4a2ca012ce8a3cf03893b333caa849b',
 '11-canonical-capsules-backend-candidate-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '12-canonical-capsules-backend-candidate.json': '69dc457816e67cf497e57fd27d7c9c1fd6086c63e00bf046d16cc6d37f09e87d',
 '13-acceptance-current-view-backend-candidate-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '14-acceptance-current-view-backend-candidate.json': '0dcf8acb70e21c0a600d0791d20443f2b11574b441c49b4b72c83aba80083c30',
 '15-installed-backend-candidate-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '16-installed-backend-candidate.json': '364b6ba5f8f18dfb71fd6fdf68531be4e01edfa9bb8718a600dcb7d0ec348dec',
 '17-bridge-installed.json': 'd45f9468af4211286df02ad95bfe0aee7a02b540c1ebf45f28a48270b739db7f',
 '18-fresh-native-quiet-backend-candidate-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '19-fresh-native-quiet-backend-candidate.json': '7f07afdda861de2a19fb3295fd9de90fc90c359e311f93bac799ad2c7aa72e13',
 '2-original-master-absent.json': 'b180f3074ccd5dc879cb7188a2a1d89b5322f4173a3e515e082925f32fa964dc',
 '20-authority-verify-backend-retained-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '21-authority-verify-backend-retained.json': '919ae33ec62b505c19c019afcbb02847a1092e8aee78059f8b2d1e5c0c891f1c',
 '22-canonical-capsules-backend-retained-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '23-canonical-capsules-backend-retained.json': 'a60aee3f0cb4b08a00a2acfb30bec90b84ff399f72fcd7c38d507777bf2d0d29',
 '24-acceptance-current-view-backend-retained-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '25-acceptance-current-view-backend-retained.json': '3467c6004b8e16247cf7e5e691d0be50f1978ab0ba8dbebf0ecdd4d9cdaefabd',
 '26-installed-backend-retained-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '27-installed-backend-retained.json': 'e85f52ff9148b61e89da92761cd587888930e7fbec7e109860da384e69672232',
 '28-bridge-installed.json': 'd45f9468af4211286df02ad95bfe0aee7a02b540c1ebf45f28a48270b739db7f',
 '29-fresh-native-quiet-backend-retained-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '3-post-up-current-inspection-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '30-fresh-native-quiet-backend-retained.json': 'cc88a49c1073a1a9b13b895c6ca0964eb95d92bd511641ae2a51d94a4c1b9ffd',
 '31-image-inspection-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '32-image-inspection.json': '15d5355416d6471fcd280fc1d2797498c7f50fea0404e35931e0acd0622fdc84',
 '33-fresh-sql-scope-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '34-fresh-sql-scope-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '35-fresh-sql-scope.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '36-fresh-sql-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '37-fresh-sql.json': 'c65da14a89f026355ed44346344ab3af9e9a91439b5d8f33b869f938a63ad8ae',
 '38-baseline-current-ten-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '39-baseline-current-ten-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '4-post-up-current-inspection-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '40-baseline-current-ten.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '41-frontend-before-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '42-frontend-before-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '43-frontend-before.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '44-restore-master-absence.json': 'b180f3074ccd5dc879cb7188a2a1d89b5322f4173a3e515e082925f32fa964dc',
 '45-restore-preflight-sql-scope-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '46-restore-preflight-sql-scope-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '47-restore-preflight-sql-scope.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '48-restore-preflight-sql-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '49-restore-preflight-sql.json': 'c65da14a89f026355ed44346344ab3af9e9a91439b5d8f33b869f938a63ad8ae',
 '5-post-up-current-inspection.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '50-bridge-stop-provenance.json': 'd45f9468af4211286df02ad95bfe0aee7a02b540c1ebf45f28a48270b739db7f',
 '51-start-frontend-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '52-start-frontend.json': 'f3c577a92098897be75c90a9897fdfcf00521b14cc7ed498cb7be522144dfb79',
 '53-frontend-after-1-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '54-frontend-after-1-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '55-frontend-after-1.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '56-frontend-after-2-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '57-frontend-after-2-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '58-frontend-after-2.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '59-frontend-after-3-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '6-resume-compose-config-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '60-frontend-after-3-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '61-frontend-after-3.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '62-frontend-after-4-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '63-frontend-after-4-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '64-frontend-after-4.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '65-frontend-after-5-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '66-frontend-after-5-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '67-frontend-after-5.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '68-frontend-after-6-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '69-frontend-after-6-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '7-resume-compose-config.json': '2b9dd5b04360ffad2500b7d74cbdf2ac5af3dc32617023be1dddab565e30dcdf',
 '70-frontend-after-6.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '71-frontend-after-7-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '72-frontend-after-7-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '73-frontend-after-7.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '74-restoration-sql-scope-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '75-restoration-sql-scope-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '76-restoration-sql-scope.json': 'd28a2bc4830d89ee69cc4ff6a49dc1b3b8555d67dea99da31b68833e6fb8e923',
 '77-restoration-sql-pre-action-ps.json': 'b5441ca20d6003e39275be5c5a60913b808bdc9d0da75cbbeb9e82bcf7aa28e1',
 '78-restoration-sql.json': 'c65da14a89f026355ed44346344ab3af9e9a91439b5d8f33b869f938a63ad8ae',
 '79-restored-master-absence.json': 'b180f3074ccd5dc879cb7188a2a1d89b5322f4173a3e515e082925f32fa964dc',
 '8-bridge-validate-config.json': 'd45f9468af4211286df02ad95bfe0aee7a02b540c1ebf45f28a48270b739db7f',
 '9-bridge-validate-slots.json': 'd45f9468af4211286df02ad95bfe0aee7a02b540c1ebf45f28a48270b739db7f',
 'private-output-acl.json': 'c2677656176161b3cea714955447cf99b57ed9f97f829309d22b7e7689dbf47e'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def _bootstrap_policy():
    file = pathlib.Path(POLICY['file'])
    before = file.lstat()
    assert file.resolve(strict=True) == file and stat.S_ISREG(before.st_mode) and before.st_nlink == 1
    raw = file.read_bytes()
    after = file.lstat()
    assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    assert sha(raw) == POLICY['sha256'], 'EXACT_HISTORICAL_POLICY_SOURCE_REQUIRED'
    module = types.ModuleType('c29_negative_capsule_historical_policy')
    module.__file__ = str(file)
    exec(compile(raw, str(file), 'exec'), module.__dict__)
    return module


def _module(reader, reference, name):
    module = types.ModuleType(name)
    module.__file__ = reference['file']
    exec(compile(reader.raw(reference), reference['file'], 'exec'), module.__dict__)
    return module


def _negative(p, value):
    for key in ('qualificationSucceeded', 'productionAdmission'):
        p.same(value[key], False, 'NEGATIVE_PROOF_CANNOT_GRANT_ADMISSION')


def _fresh_engine(p, old, fresh):
    # Compose emitted the identical unique environment pairs in a different
    # order, as did the exact unique bind strings. Keep every value and all other
    # Engine fields in the old exact
    # predicate; no environment value is replaced or ignored.
    before, after = json.loads(json.dumps(old)), json.loads(json.dumps(fresh))
    for containers in (before, after):
        for container in containers.values():
            values = container['Config']['Env']
            assert all(isinstance(value, str) and '=' in value for value in values)
            assert len({value.split('=', 1)[0] for value in values}) == len(values), 'DUPLICATE_ENGINE_ENVIRONMENT_KEY'
            container['Config']['Env'] = sorted(values)
            binds = container['HostConfig'].get('Binds', [])
            assert all(isinstance(value, str) for value in binds) and len(set(binds)) == len(binds), \
                'DUPLICATE_ENGINE_BIND'
            container['HostConfig']['Binds'] = sorted(binds)
    p.validate_fresh_engine(before, after, NONCE)


def _inventories(p, reader, baseline, restoration):
    decoded = []
    seen_refs, seen_pids = set(), set()
    ordinal = 0
    previous = None
    ps = ['docker', 'compose', '-f', 'D:/sabalanerp/docker-compose.local.yml',
          'ps', '--all', '--no-trunc', '--format', 'json']
    for phase, record, count in (('baseline', baseline, 41), ('restoration', restoration, 39)):
        inventory = reader.json(record['originalChildrenRef'])
        p.shape(inventory, 'format phase firstOrdinal endOrdinal children allOriginalChildrenClosed interrupted',
                'CURRENT_ORIGINAL_INVENTORY_SCHEMA')
        p.same(inventory['format'], 'sabalan-c16-original-child-inventory/v1', 'CURRENT_INVENTORY_FORMAT')
        p.same(inventory['phase'], phase, 'CURRENT_INVENTORY_PHASE')
        p.same(inventory['firstOrdinal'], ordinal + 1, 'CURRENT_INVENTORY_SEQUENCE')
        p.same(len(inventory['children']), count, 'EXACT_CURRENT_ORIGINAL_COUNT')
        p.same(inventory['allOriginalChildrenClosed'], True, 'CURRENT_OWNER_NOT_CLOSED')
        p.same(inventory['interrupted'], False, 'CURRENT_OWNER_INTERRUPTED')
        for item in inventory['children']:
            p.shape(item, 'ordinal key ref', 'CURRENT_CHILD_INVENTORY_ITEM')
            ordinal += 1
            p.same(item['ordinal'], ordinal, 'CURRENT_CHILD_SEQUENCE_GAP')
            ref = item['ref']
            p.same(pathlib.Path(ref['file']).parent, ACTUAL, 'CURRENT_CHILD_OUTSIDE_ORIGINAL_OWNER')
            key = (p.normalize_path(ref['file']), ref['sha256'])
            assert key not in seen_refs, 'DUPLICATE_CURRENT_ORIGINAL_REFERENCE'
            seen_refs.add(key)
            row, output, stdin = p.child(reader, ref)
            assert row['originalPid'] not in seen_pids, 'DUPLICATE_CURRENT_ORIGINAL_PID'
            seen_pids.add(row['originalPid'])
            name = pathlib.Path(ref['file']).name
            p.same(sha(encoded(row['argv'])), EXPECTED_ARGV_SHA[name], 'EXACT_SOURCE_OWNED_ORIGINAL_ARGV')
            if row['argv'][0] == 'docker' and row['argv'] != ps:
                p.same(previous, ps, 'DOCKER_WITHOUT_IMMEDIATE_CANONICAL_PS')
            previous = row['argv']
            decoded.append((phase, item['key'], ref, row, output, stdin))
        p.same(inventory['endOrdinal'], ordinal, 'CURRENT_INVENTORY_END')
    p.same(len(decoded), 80, 'EXACT_EIGHTY_CURRENT_ORIGINALS')
    p.same(set(EXPECTED_ARGV_SHA), {pathlib.Path(v[2]['file']).name for v in decoded},
           'CURRENT_ORIGINAL_ARGV_PROFILE_INCOMPLETE')
    return decoded


def _capsule(p, reader, row_ref, source, spec, cid):
    row, output, stdin = p.child(reader, row_ref)
    p.same(row['argv'][:8], ['docker', 'exec', '-i', cid, '/usr/bin/python3', '-I', '-B', '-c'],
           'FULL_CAPSULE_ORIGINAL_SCOPE')
    payload = json.loads(stdin)
    p.shape(payload, 'sourceBase64 spec', 'FULL_CAPSULE_INPUT_SCHEMA')
    p.same(p.decode64(payload['sourceBase64']), source, 'FULL_CANONICAL_CAPSULE_SOURCE')
    p.same(payload['spec'], spec, 'FULL_CANONICAL_CAPSULE_SPEC')
    assert "sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps(p['spec']).encode()))" in row['argv'][8], \
        'BINARY_STDIN_CAPSULE_BOOTSTRAP_REQUIRED'
    result = json.loads(output)
    p.shape(result, 'readOnly capsulesVerified directoryIdentities prisma inquiry lockIdentities inventoryChild databaseExecuted nativeActorStarted productionAdmission',
            'FULL_CAPSULE_RESULT_SCHEMA')
    for key, expected in (('readOnly', True), ('capsulesVerified', 2), ('databaseExecuted', False),
                          ('nativeActorStarted', False), ('productionAdmission', False)):
        p.same(result[key], expected, 'FULL_CAPSULE_READONLY_RESULT')
    p.same(result['prisma'], spec['prisma']['capsule'], 'FULL_CAPSULE_PRISMA_INVENTORY')
    p.same(result['inquiry'], {key: spec['inquiry'][key] for key in ('entries', 'bytes', 'inventorySha256')},
           'FULL_CAPSULE_INQUIRY_INVENTORY')
    child = result['inventoryChild']
    p.shape(child, 'originalPid code stdoutEof stderrEof', 'CAPSULE_INVENTORY_ORIGINAL_SCHEMA')
    assert type(child['originalPid']) is int and child['originalPid'] > 0
    p.same(child['code'], 0, 'CAPSULE_INVENTORY_ORIGINAL_FAILED')
    p.same(child['stdoutEof'], True, 'CAPSULE_INVENTORY_STDOUT_OPEN')
    p.same(child['stderrEof'], True, 'CAPSULE_INVENTORY_STDERR_OPEN')
    names = ('deployment-online-worker.lock', 'deployment-runtime-control.lock', 'deployment-write-admission.lock')
    base = '/app/online-runtime-acceptance/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d/coordination/'
    p.same([value['file'] for value in result['lockIdentities']], [base + name for name in names],
           'EXACT_THREE_CAPSULE_LOCKS')
    for lock in result['lockIdentities']:
        p.shape(lock, 'file identity', 'CAPSULE_LOCK_SCHEMA')
        identity = lock['identity']
        assert len(identity) == 8 and identity[6] == 0 and identity[7] == 1
        assert stat.S_ISREG(identity[5]) and not identity[5] & 0o077, 'CAPSULE_LOCK_PRIVATE_METADATA'
    return result


def _acceptance_header(p, acceptance):
    p.shape(acceptance, 'format namedVolume subpath target createdOriginalRef physicalEmpty actorEntries proof currentViewRefs canonicalCapsuleRefs',
            'TYPED_ACCEPTANCE_SCHEMA')
    p.same(acceptance['format'], 'sabalan-C29-exact-two-readonly-capsule-acceptance/v1', 'TYPED_ACCEPTANCE_FORMAT')
    p.same(acceptance['physicalEmpty'], False, 'NONEMPTY_CAPSULE_VIEW_CANNOT_CLAIM_EMPTY')
    p.same(acceptance['actorEntries'], [], 'CAPSULE_VIEW_HAS_ACTOR_ENTRIES')
    p.same(acceptance['namedVolume'], p.ACCEPTANCE_VOLUME, 'CAPSULE_VIEW_NAMED_VOLUME')
    p.same(acceptance['target'], p.ACCEPTANCE_TARGET, 'CAPSULE_VIEW_TARGET')
    p.same(acceptance['subpath'], SUBPATH, 'EXACT_NESTED_ACCEPTANCE_SUBPATH')
    p.same(set(acceptance['currentViewRefs']), set(p.ROLES), 'EXACT_TWO_CURRENT_ROOT_VIEWS')
    p.same(set(acceptance['canonicalCapsuleRefs']), set(p.ROLES), 'EXACT_TWO_FULL_CAPSULE_PROOFS')


def validate_handoff(file, digest):
    if sys.flags.optimize:
        raise RuntimeError('NONOPTIMIZED_TYPED_VERIFIER_REQUIRED')
    assert digest == HANDOFF_SHA, 'EXACT_C29_NEGATIVE_HANDOFF_REQUIRED'
    assert pathlib.Path(file).resolve(strict=True) == ACTUAL / 'handoff.json', 'EXACT_C29_HANDOFF_PATH'
    p = _bootstrap_policy()
    reader = p.Reader()
    reader.raw(POLICY)
    handoff = reader.json({'file': str(pathlib.Path(file)), 'sha256': digest})
    p.shape(handoff, 'format cancellationRef baselineRef restorationRef contextRef sourcePins qualificationSucceeded productionAdmission historicalFailedPrefixRef',
            'TYPED_NEGATIVE_HANDOFF_SCHEMA')
    p.same(handoff['format'], 'sabalan-C29-post-up-negative-recovery-handoff/v1', 'TYPED_HANDOFF_FORMAT')
    _negative(p, handoff)
    ctx = p.context(reader.raw(handoff['contextRef']))
    p.same(ctx['sourceCommit'], SOURCE_COMMIT, 'EXACT_HISTORICAL_SOURCE_COMMIT')
    p.same(ctx['operationRoot'], ROOT, 'EXACT_FAILED_OPERATION_ROOT')
    plan = reader.json(ctx['originalSupervisor']['plan'])
    reader.sources(handoff['sourcePins'], plan)
    p.same(len(handoff['sourcePins']), 1553, 'EXACT_PRESERVED_SOURCE_SNAPSHOTS')
    archived = {p.normalize_path(pin['originalPath']): pin['sha256'] for pin in handoff['sourcePins']}
    for source, source_sha in plan['sourceFiles'].items():
        p.same(archived.get(p.normalize_path(source)), source_sha, 'FROZEN_SOURCE_ARCHIVE_MISSING')
    reader.raw(PREFIX_PINS)
    prefix_module = _module(reader, PREFIX, 'c29_literal_historical_prefix')
    prefix = prefix_module.validate_resume_prefix(ctx, reader)
    recorded_prefix = reader.json(handoff['historicalFailedPrefixRef'])
    p.same(recorded_prefix, {key: value for key, value in prefix.items()
                            if key not in ('decodedRows', 'failedChild', 'inputs', 'streamingInputs')},
           'FAILED_ORIGINAL_PREFIX_REWRITTEN')
    review = reader.json(REVIEW)
    p.same(review['handoff'], {'file': str(ACTUAL / 'handoff.json'), 'sha256': HANDOFF_SHA},
           'ACTUAL_RESTORATION_REVIEW_JOIN')
    _negative(p, review)
    resume = _module(reader, RESUME, 'c29_exact_post_up_resume_source')
    baseline, restore = reader.json(handoff['baselineRef']), reader.json(handoff['restorationRef'])
    p.shape(baseline, 'format contextRef historicalFailedPrefixRef cancellationRef historicalCandidateReplacement oldTargets protectedEight authorityCohort acceptance freshServices freshConfigurations evidenceRefs originalChildrenRef sourceCommit qualificationSucceeded productionAdmission adoptsOriginalPopen successfulNativeClosure historicalFailedChildPassed',
            'TYPED_BASELINE_SCHEMA')
    p.same(baseline['format'], 'sabalan-C29-post-up-unqualified-physical-baseline/v1', 'TYPED_BASELINE_FORMAT')
    p.same(baseline['sourceCommit'], SOURCE_COMMIT, 'BASELINE_SOURCE_COMMIT')
    p.shape(restore, p.SHAPES['restoration'], 'RESTORATION_SCHEMA')
    p.same(restore['format'], p.FORMATS['restoration'], 'RESTORATION_FORMAT')
    for value in (baseline, restore):
        _negative(p, value)
        p.same(value['contextRef'], handoff['contextRef'], 'NEGATIVE_CONTEXT_JOIN')
        p.same(value['cancellationRef'], handoff['cancellationRef'], 'NEGATIVE_CANCELLATION_JOIN')
    for key in ('adoptsOriginalPopen', 'successfulNativeClosure', 'historicalFailedChildPassed'):
        p.same(baseline[key], False, 'FALSE_HISTORICAL_NATIVE_CLAIM')
    p.same(restore['baselineRef'], handoff['baselineRef'], 'RESTORED_BASELINE_JOIN')
    p.same(baseline['historicalFailedPrefixRef'], handoff['historicalFailedPrefixRef'], 'BASELINE_PREFIX_JOIN')
    p.same(handoff['cancellationRef'], prefix['cancellationRef'], 'ORIGINAL_CANCELLATION_JOIN')
    decoded = _inventories(p, reader, baseline, restore)
    current_refs = {(p.normalize_path(value[2]['file']), value[2]['sha256']) for value in decoded}
    historical_refs = {(p.normalize_path(value['file']), value['sha256']) for value in prefix['childRefs']}
    def required(ref):
        assert (p.normalize_path(ref['file']), ref['sha256']) in current_refs | historical_refs, \
            'PROOF_CHILD_NOT_ORIGINAL_OWNER_INVENTORY'
    evidence = baseline['evidenceRefs']
    fresh_full, fresh_rows = p.inspect_child(reader, prefix['freshInspectionRef'])
    fresh = {value['service']: value for value in fresh_rows if value['service'] in p.ROLES}
    p.same(fresh, baseline['freshConfigurations'], 'FRESH_PHYSICAL_CONFIGURATION_JOIN')
    p.validate_services(ctx, fresh_rows, fresh=fresh)
    p.same({value['service']: value for value in baseline['freshServices']},
           {value['service']: value for value in fresh_rows}, 'BASELINE_CURRENT_SERVICES_JOIN')
    slots = {value['Config']['Labels']['com.docker.compose.service']: value for value in fresh_full
             if value['Config']['Labels']['com.docker.compose.service'] in p.ROLES}
    old_full, _ = p.inspect_child(reader, reader.json(handoff['cancellationRef'])['evidenceRefs']['initialInspection'])
    old_slots = {value['Config']['Labels']['com.docker.compose.service']: value for value in old_full
                 if value['Config']['Labels']['com.docker.compose.service'] in p.ROLES}
    cohort = baseline['authorityCohort']
    p.shape(cohort, 'nonce prepared verified', 'AUTHORITY_COHORT_SCHEMA')
    p.same(cohort['nonce'], NONCE, 'EXACT_POST_UP_AUTHORITY_NONCE')
    config = p.child_json(reader, evidence['fresh-compose-config-before'])
    p.same(p.child_json(reader, evidence['fresh-compose-config-after']), config, 'POST_UP_CONFIGURATION_CHANGED')
    p.same(p.child_json(reader, evidence['resume-compose-config']), config, 'RESUME_CONFIGURATION_CHANGED')
    p.validate_authority_configuration(config, NONCE)
    p.validate_acceptance_configuration(config, NONCE)
    p.validate_authority_slots(slots, NONCE)
    p.validate_acceptance_slots(slots, NONCE)
    _fresh_engine(p, old_slots, slots)
    authority_source = p.source_raw(reader, handoff, 'tests/online-deployment/application-native-authority-cohort.fixture.py')
    prepared, verified = {}, {}
    for role in p.ROLES:
        kind = 'runtime' if role == p.ROLES[0] else 'jobs'
        root = '/app/qualification-authority-root' if kind == 'runtime' else '/app/qualification-jobs-root'
        old_id = next(value['id'] for value in ctx['targets'] if value['service'] == role)
        required(cohort['prepared'][role])
        prepared[role] = p.metadata_child(reader, cohort['prepared'][role], authority_source,
            {'mode': 'create', 'kind': kind, 'nonce': NONCE, 'root': root, 'expected': None, 'peerExpected': None}, old_id)
    for role in p.ROLES:
        peer = p.ROLES[1] if role == p.ROLES[0] else p.ROLES[0]
        kind = 'runtime' if role == p.ROLES[0] else 'jobs'
        root = '/app/qualification-authority-root' if kind == 'runtime' else '/app/qualification-jobs-root'
        required(cohort['verified'][role])
        verified[role] = p.metadata_child(reader, cohort['verified'][role], authority_source,
            {'mode': 'verify', 'kind': kind, 'nonce': NONCE, 'root': root, 'expected': prepared[role]['namespace'],
             'peerExpected': prepared[peer]['namespace']}, fresh[role]['id'])
    authority_namespaces = p.validate_authority_results(prepared, verified, NONCE)
    acceptance = baseline['acceptance']
    _acceptance_header(p, acceptance)
    namespace_source = p.source_raw(reader, handoff, 'namespace_metadata.py')
    required(acceptance['createdOriginalRef'])
    created = p.metadata_child(reader, acceptance['createdOriginalRef'], namespace_source,
        {'mode': 'create', 'nonce': NONCE, 'expected': None}, ctx['targets'][0]['id'])
    capsule_source = p.source_raw(reader, handoff, 'tests/online-deployment/historical-capsule-preflight.fixture.py')
    spec = p.child_json(reader, evidence['canonical-capsule-spec'])
    p.same(sha(json.dumps(spec, separators=(',', ':'), ensure_ascii=False).encode()),
           '604472f73c22e1be20a8d63672be5dcafb2b4044d9858a6224df81339f835472', 'EXACT_CANONICAL_CAPSULE_SPEC')
    diagnostic = reader.json({'file': str(resume.DIAG), 'sha256': resume.PINS[str(resume.DIAG)]})
    capsules, views = {}, {}
    for role in p.ROLES:
        required(acceptance['canonicalCapsuleRefs'][role])
        required(acceptance['currentViewRefs'][role])
        capsules[role] = _capsule(p, reader, acceptance['canonicalCapsuleRefs'][role], capsule_source, spec, fresh[role]['id'])
        views[role] = p.child_json(reader, acceptance['currentViewRefs'][role],
            ['docker', 'exec', fresh[role]['id'], '/usr/bin/python3', '-I', '-B', '-c', resume.ROOT_PROBE])
        expected = p.child_json(reader, diagnostic['rootProofs'][role])
        proof = resume.guard_acceptance(created, views[role], expected, SUBPATH, capsules[role])
        p.same(proof, acceptance['proof'], 'TYPED_CURRENT_ACCEPTANCE_PROOF_JOIN')
    p.same({key: value for key, value in capsules[p.ROLES[0]].items() if key != 'inventoryChild'},
           {key: value for key, value in capsules[p.ROLES[1]].items() if key != 'inventoryChild'},
           'BOTH_ROLE_FULL_CAPSULE_PROOFS_DIFFER')
    previous = reader.json(ctx['historicalCandidateReplacement'])
    p.same(previous['pass'], True, 'HISTORICAL_IMAGE_BUILD_NOT_COMPLETE')
    p.same(previous['phase'], 'COMPLETE', 'HISTORICAL_IMAGE_BUILD_PHASE')
    images = []
    installed_source = p.source_raw(reader, handoff, 'tests/online-deployment/installed-native-image-probe.fixture.mjs')
    quiet = p.quiet_source(reader, handoff)
    for role in p.ROLES:
        old_evidence = previous['roleEvidence']['candidate' if role == p.ROLES[0] else 'main']
        p.same(slots[role]['Image'], old_evidence['image'], 'IMMUTABLE_INSTALLED_IMAGE_JOIN')
        material = reader.json({'file': old_evidence['materialReceiptFile'], 'sha256': old_evidence['materialReceiptSha256']})
        images.append(reader.json({'file': old_evidence['imageReceiptFile'], 'sha256': old_evidence['imageReceiptSha256']}))
        required(evidence['installed-' + role])
        installed = p.child_json(reader, evidence['installed-' + role],
            ['docker', 'exec', '-i', fresh[role]['id'], 'node', '--input-type=module'], installed_source)
        p.validate_installed(installed, material)
        required(evidence['fresh-native-quiet-' + role])
        p.validate_empty_native(p.child_json(reader, evidence['fresh-native-quiet-' + role],
            ['docker', 'exec', fresh[role]['id'], '/usr/bin/python3', '-I', '-B', '-c', quiet]))
    p.validate_image_inspection(p.child_json(reader, evidence['image-inspection'],
        ['docker', 'image', 'inspect', *[value['image'] for value in ctx['targets']]]), images)
    p.sql_child(reader, evidence['fresh-sql'], ctx, list(fresh.values()))
    for key in ('stopRef', 'pendingRef', 'bindingRef', 'originalOwnerSourceRef', 'originalVerifierSourceRef'):
        p.same(restore[key], ctx[key], 'RESTORE_ORIGINAL_PROVENANCE_JOIN')
        reader.raw(restore[key])
    p.same(reader.raw(restore['externalRestorerSourceRef']), reader.raw(RESUME), 'EXACT_EXTERNAL_RESTORER_SOURCE')
    restore_evidence = restore['evidenceRefs']
    p.same(restore_evidence['originalClosed'], prefix['originalClosedRef'], 'RESTORE_ORIGINAL_MASTER_CLOSURE')
    before, before_rows = p.inspect_child(reader, restore_evidence['frontendBefore'])
    p.validate_services(ctx, before_rows, fresh=fresh)
    front = next(value for value in before if value['Config']['Labels']['com.docker.compose.service'] == 'frontend')
    stop = reader.json(ctx['stopRef'])
    p.same(front['Id'], stop['frontend']['id'], 'ORIGINAL_STOP_FRONTEND_ID')
    p.same(front['State']['FinishedAt'], stop['stopped']['finishedAt'], 'ORIGINAL_STOP_FRONTEND_FINISH')
    p.same(front['State']['ExitCode'], stop['stopped']['exitCode'], 'ORIGINAL_STOP_FRONTEND_EXIT')
    required(restore_evidence['startFrontend'])
    p.child(reader, restore_evidence['startFrontend'], ['docker', 'start', front['Id']])
    after, after_rows = p.inspect_child(reader, restore_evidence['frontendAfter'])
    by_role = {value['service']: value for value in after_rows}
    restored = by_role['frontend']
    old_front = next(value for value in ctx['protectedEight'] if value['service'] == 'frontend')
    for key in ('id', 'image', 'configurationSha256'):
        p.same(restored[key], old_front[key], 'SAME_ORIGINAL_FRONTEND_REQUIRED')
    assert restored['startedAt'] != old_front['startedAt'] and type(restored['pid']) is int and restored['pid'] > 0
    p.same(restored['running'], True, 'RESTORED_FRONTEND_NOT_RUNNING')
    p.same(restored['health'], 'healthy', 'RESTORED_FRONTEND_NOT_HEALTHY')
    for expected in ctx['protectedEight']:
        if expected['service'] != 'frontend':
            p.same(by_role[expected['service']], expected, 'PROTECTED_RESTORE_SERVICE_CHANGED')
    for role in p.ROLES:
        p.same(by_role[role], fresh[role], 'FRESH_SLOT_CHANGED_DURING_FRONTEND_RESTORE')
    for key in ('sameFrontendId', 'sameFrontendConfig', 'sameFrontendImage', 'pendingSettled'):
        p.same(restore[key], True, 'RESTORATION_CLAIM_NOT_TRUE')
    p.same(restore['nativeCompletionClaimed'], False, 'FALSE_NATIVE_COMPLETION_CLAIM')
    p.same(restore['restoredFrontend'], restored, 'RESTORED_FRONTEND_READBACK_JOIN')
    p.same(restore['protectedOtherNine'], [value for value in after_rows if value['service'] != 'frontend'],
           'RESTORED_OTHER_NINE_JOIN')
    p.sql_child(reader, restore_evidence['restorationSql'], ctx, list(fresh.values()))
    bridges = [json.loads(value[5]) for value in decoded if value[3]['argv'][0:2] ==
               ['C:/Program Files/nodejs/node.exe', str(Q / 'C29-finite-negative-recovery-source-r2-private-output-20261024/canonical_bridge.mjs')]
               and value[5] is not None and json.loads(value[5]).get('mode') == 'stop-provenance']
    p.same(len(bridges), 1, 'EXACT_ONE_CANONICAL_STOP_PROVENANCE_CHILD')
    bridge = bridges[0]
    for key, expected in (('stop', stop), ('frontend', front), ('binding', reader.json(ctx['bindingRef'])),
                          ('plan', plan), ('start', reader.json(ctx['originalSupervisor']['started'])),
                          ('closed', reader.json(prefix['originalClosedRef'])), ('currentBirth', 'ABSENT'),
                          ('originalOwnerSha256', ctx['originalOwnerSourceRef']['sha256']),
                          ('originalVerifierSha256', ctx['originalVerifierSourceRef']['sha256'])):
        p.same(bridge[key], expected, 'CANONICAL_ORIGINAL_FRONTEND_PROVENANCE_JOIN')
    assert not pathlib.Path(ctx['pendingRef']['file']).exists(), 'PENDING_RESTORATION_NOT_ACTUALLY_SETTLED'
    reader.recheck()
    return {'format': FORMAT, 'sourceCommit': SOURCE_COMMIT, 'operationRoot': ROOT,
            'historicalCandidateReplacement': ctx['historicalCandidateReplacement'],
            'identities': {role: {key: fresh[role][key] for key in ('id', 'image', 'startedAt')} for role in p.ROLES},
            'qualificationSlots': fresh, 'protectedEight': [value for value in after_rows if value['service'] not in p.ROLES],
            'acceptance': {'namedVolume': p.ACCEPTANCE_VOLUME, 'subpath': SUBPATH, 'target': p.ACCEPTANCE_TARGET,
                           'nonce': NONCE, 'namespace': views[p.ROLES[0]]['identity'],
                           'format': 'sabalan-C29-exact-two-readonly-capsule-acceptance/v1',
                           'physicalEmpty': False, 'actorEntries': [],
                           'canonicalCapsules': capsules[p.ROLES[0]]},
            'authorityCohort': {'nonce': NONCE, 'namespaces': authority_namespaces},
            'inputs': reader.inputs, 'streamingInputs': reader.streaming,
            'qualificationSucceeded': False, 'productionAdmission': False, 'adoptsOriginalPopen': False}

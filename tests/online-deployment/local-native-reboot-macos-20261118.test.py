import base64
import io
import tarfile
import tempfile
import runpy
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
import sys
from unittest.mock import patch


class MacLocalIncident(unittest.TestCase):
    def setUp(self):
        file = Path(__file__).resolve().parents[2] / 'deploy/scripts/local-native-reboot-macos-20261118.py'
        spec = importlib.util.spec_from_file_location('mac_incident', file)
        self.policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.policy)
        i = self.policy.INCIDENT
        self.active = dict(format='sabalan-runtime-native/v1', phase='ACTIVE', role='standalone',
            instanceId=i['instanceId'], namespace='sabalan-rt-' + i['instanceId'], previousSha256=None,
            guardian=dict(bootId=i['oldBootId'], pid=1, pidNamespace=i['pidNamespace'], startTicks=i['startTicks']),
            clusterIdentifier=i['systemIdentifier'], initialDatabase=dict(name='sabalanerp', oid=i['databaseOid']))
        volumes = ['backend_recovery', 'backend_storage_accounting_contracts', 'backend_storage_contracts',
            'backend_storage_dispatch_documents', 'backend_storage_hr_hiring', 'backend_storage_sepidar_backups',
            'backend_storage_support_tickets', 'backend_uploads', 'inquiry_data', 'recovery_coordination', 'redis_data']
        files = ['original-active.json', 'container-inspect.private.json', 'backend-old-rootfs.tar',
            'postgres-sabalanerp.dump', 'inquiry-consistent.db', 'redis-consistent.rdb', 'restore-verification.json']
        files += ['volume-sabalanerp-local_' + name + '.tar' for name in volumes]
        self.manifest = dict(format='sabalan-macos-local-incident-checkpoint/v1', project='sabalanerp-local',
            activeSha256=i['activeSha256'], backendContainerId=i['oldContainerId'], oldImageId=i['oldImageId'],
            observedBootId=i['newBootId'], clusterIdentifier=i['systemIdentifier'], databaseOid=i['databaseOid'],
            checkpointPurpose='LOCAL_DEVELOPMENT_RECOVERY', independentBackup=False, productionAdmission=False,
            databaseRestoreVerified=True, sqliteIntegrityVerified=True, redisIntegrityVerified=True,
            volumeNames=sorted('sabalanerp-local_' + name for name in volumes),
            entries=[dict(name=name, bytes=42, sha256=i['activeSha256'] if name == 'original-active.json' else '9' * 64) for name in files])
        self.proof = dict(format='sabalan-macos-local-recovery-host-proof/v1', project='sabalanerp-local',
            hostPlatform='darwin', purpose='LOCAL_DEVELOPMENT_RECOVERY', productionAdmission=False,
            backendContainerId=i['oldContainerId'], oldImageId=i['oldImageId'], candidateImageId='sha256:' + '8' * 64,
            activeSha256=i['activeSha256'], bootId=i['newBootId'], publicIngress=False, hostPort=5001,
            database=dict(system=i['systemIdentifier'], oid=i['databaseOid'], oldSessions=0, allTagged=0, prepared=0))
        self.observed = dict(project='sabalanerp-local', nodeEnv='development', role='standalone',
            bootId=i['newBootId'], systemIdentifier=i['systemIdentifier'], databaseOid=i['databaseOid'],
            oldSessions=0, allTaggedSessions=0, prepared=0, publicIngress=False, externalCredentials=False,
            historicalActive=[], historicalIncidentEvidence=[], imageId=self.proof['candidateImageId'],
            hostProof=self.proof, hostProofSha256='3' * 64)
        raw = (json.dumps(self.manifest, sort_keys=True, separators=(',', ':')) + '\n').encode()
        self.digest = hashlib.sha256(raw).hexdigest()
        self.proof['checkpoint'] = dict(readbackVerified=True, databaseRestoreVerified=True, independentBackup=False,
            path='/Users/ferferi/Documents/SabalanERP-local-recovery/20261118-macos-test', manifestSha256=self.digest,
            manifestRawBase64=base64.b64encode(raw).decode())
        # Synthetic checkpoint evidence never changes the real incident allowlist.
        fixture = patch.object(self.policy, 'MANIFEST_SHA', self.digest)
        fixture.start()
        self.addCleanup(fixture.stop)

    def receipt(self, active=None, observed=None):
        return self.policy.reconcile(active or self.active, self.policy.INCIDENT['activeSha256'], observed or self.observed)

    def test_local_abandonment_is_distinct_from_completion_and_production(self):
        receipt = self.receipt()
        self.assertEqual(receipt['phase'], 'ABANDONED_ON_VM_REBOOT')
        for name in ['nativeReaped', 'externalEffectsCompleted', 'productionAdmission', 'independentBackup']:
            self.assertIs(receipt[name], False)
        self.assertTrue(self.policy.valid_receipt(self.active, self.policy.INCIDENT['activeSha256'], receipt, self.observed))

    def test_changed_environment_or_live_work_refuses_admission(self):
        for field, value in [('project', 'sabalanerp'), ('nodeEnv', 'production'), ('role', 'control'),
            ('bootId', self.policy.INCIDENT['oldBootId']), ('databaseOid', '1'), ('systemIdentifier', '1'),
            ('oldSessions', 1), ('allTaggedSessions', 1), ('prepared', 1), ('publicIngress', True), ('externalCredentials', True)]:
            with self.subTest(field=field):
                observed = copy.deepcopy(self.observed)
                observed[field] = value
                with self.assertRaises(RuntimeError):
                    self.receipt(observed=observed)

    def test_changed_original_identity_or_other_incident_refuses_admission(self):
        for field, value in [('phase', 'QUIESCENT'), ('role', 'control'), ('previousSha256', '0' * 64),
            ('instanceId', '0' * 48), ('clusterIdentifier', '1')]:
            active = copy.deepcopy(self.active)
            active[field] = value
            with self.assertRaises(RuntimeError):
                self.receipt(active=active)
        with self.assertRaises(RuntimeError):
            self.policy.reconcile(self.active, '0' * 64, self.observed)

    def test_restore_readback_and_exact_checkpoint_are_required(self):
        for field, value in [('readbackVerified', False), ('databaseRestoreVerified', False), ('manifestSha256', '0' * 64),
            ('manifestRawBase64', ''), ('independentBackup', True), ('path', '/tmp/other')]:
            observed = copy.deepcopy(self.observed)
            observed['hostProof']['checkpoint'][field] = value
            with self.assertRaises((RuntimeError, ValueError)):
                self.receipt(observed=observed)

    def test_new_receipt_cannot_assert_graceful_reaping(self):
        receipt = self.receipt()
        receipt['nativeReaped'] = True
        self.assertFalse(self.policy.valid_receipt(self.active, self.policy.INCIDENT['activeSha256'], receipt, self.observed))

    def test_optimized_python_still_rejects_wrong_checkpoint_before_docker(self):
        root = Path(__file__).resolve().parents[2]
        script = '''import runpy,tempfile,pathlib,sys
sys.platform='darwin'
module=runpy.run_path('scripts/reconcile-local-macos-20261118.py')
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'manifest.json').write_text('{"entries":[]}')
 def forbidden(*a,**k):raise Exception('DOCKER_REACHED')
 module['execute'].__globals__['docker']=forbidden
 try:module['execute'](p,'sha256:'+'8'*64)
 except RuntimeError:print('OPTIMIZED_GATE_REJECTED')
 else:raise Exception('UNVERIFIED_CHECKPOINT_ACCEPTED')
'''
        result = subprocess.run([sys.executable, '-O', '-c', script], cwd=root, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('OPTIMIZED_GATE_REJECTED', result.stdout)


class ImageMigrationEvidence(unittest.TestCase):
    def archive(self, root, entries):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w') as layer:
            for name, value in entries:
                member = tarfile.TarInfo(name)
                if value is None:
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/tmp/replacement'
                    layer.addfile(member)
                else:
                    member.size = len(value)
                    layer.addfile(member, io.BytesIO(value))
        blobs = {}
        def descriptor(value):
            checksum = hashlib.sha256(value).hexdigest()
            blobs['blobs/sha256/' + checksum] = value
            return dict(digest='sha256:' + checksum, size=len(value))
        layer = descriptor(buffer.getvalue())
        config = descriptor(b'{}')
        manifest = descriptor(json.dumps(dict(config=config, layers=[layer])).encode())
        manifest['platform'] = dict(architecture='arm64', os='linux')
        index = descriptor(json.dumps(dict(manifests=[manifest])).encode())
        path = root / 'image.tar'
        with tarfile.open(path, 'w') as archive:
            blobs['index.json'] = json.dumps(dict(manifests=[index])).encode()
            for name, value in blobs.items():
                entry = tarfile.TarInfo(name); entry.size = len(value)
                archive.addfile(entry, io.BytesIO(value))
        return path, index['digest']

    def test_catalog_uses_verified_image_identity(self):
        module = runpy.run_path(str(Path(__file__).resolve().parents[2] / 'scripts/reconcile-local-macos-20261118.py'))
        with tempfile.TemporaryDirectory() as temp:
            path, identity = self.archive(Path(temp), [('app/prisma/migrations/example/migration.sql', b'SELECT 1;')])
            self.assertEqual(module['image_migrations'](path, identity), dict(example=hashlib.sha256(b'SELECT 1;').hexdigest()))
            with self.assertRaises(RuntimeError):
                module['image_migrations'](path, 'sha256:' + '0' * 64)

    def test_ancestor_whiteouts_and_links_are_rejected(self):
        module = runpy.run_path(str(Path(__file__).resolve().parents[2] / 'scripts/reconcile-local-macos-20261118.py'))
        for entry in [('app/.wh.prisma', b''), ('app/prisma/.wh.migrations', b''),
                ('.wh.app', b''), ('.wh..wh..opq', b''), ('app/prisma', None),
                ('app/prisma/migrations/example/migration.sql', None)]:
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as temp:
                path, identity = self.archive(Path(temp), [('app/prisma/migrations/example/migration.sql', b'SELECT 1;'), entry])
                with self.assertRaises(RuntimeError):
                    module['image_migrations'](path, identity)


if __name__ == '__main__':
    unittest.main()

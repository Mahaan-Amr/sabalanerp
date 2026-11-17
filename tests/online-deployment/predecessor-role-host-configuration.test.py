import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import unittest

MODULE = Path(__file__).resolve().parents[2] / "deploy/scripts/predecessor-role-host-configuration.py"
SPEC = importlib.util.spec_from_file_location("role_configuration", MODULE)
roles = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(roles)

SERVICES = ("backend", "frontend", "inquiry", "nginx", "postgres", "clamav")
GRAPH = {name: "sha256:" + str(i) * 64 for i, name in enumerate(SERVICES, 1)}
PASSWORD = b"a" * 42 + b"Y"
ORIGINAL = b"# preserve this spacing \r\nPOSTGRES_USER=owner\r\nPOSTGRES_PASSWORD=original-secret\r\nPOSTGRES_DB=erp"
TARGET = ORIGINAL + b"\r\nBACKEND_DATABASE_USER=sabalan_application_runtime\r\nBACKEND_DATABASE_PASSWORD=" + PASSWORD + b"\r\n"
SUFFIX = "@postgres:5432/erp?schema=public&connection_limit=10&pool_timeout=10&application_name=sabalanerp-backend"
CONTROL_URL = "postgresql://owner:original-secret" + SUFFIX
RUNTIME_URL = "postgresql://sabalan_application_runtime:" + PASSWORD.decode() + SUFFIX


def private_write(path, body):
    if not path.exists():
        path.touch(mode=0o600)
    path.write_bytes(body)


class HostConfigurationTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in (".deploy-state", "reports", "coordination"):
            (self.root / name).mkdir(mode=0o700)
        self.lock = self.root / ".deploy-state/deployment.lock"
        self.lock.touch(mode=0o600)
        self.env = self.root / "environment.env"
        private_write(self.env, ORIGINAL)
        self.session = {
            "deploymentId": "deploy-role-455",
            "releaseId": "release-predecessor",
            "targetCommit": "a" * 40,
            "owner": "protected-owner",
            "leaseToken": "c" * 64,
            "bootstrap": False, "purpose": "predecessor-role-cutover",
            "controlImage": GRAPH["backend"],
            "rollbackReleaseSet": GRAPH,
            "preservedClamav": {"selection": {"image": GRAPH["clamav"]}},
        }
        self.write_phase("MUTATION_STARTED")
        marker = {key: self.session[key] for key in ("deploymentId", "releaseId")}
        private_write(self.root / "coordination/deployment-maintenance.json", json.dumps(marker).encode())
        self.checkpoint = {
            **marker, "targetCommit": self.session["targetCommit"],
            "checksum": "d" * 64, "rollbackReleaseSet": GRAPH,
            "canonicalMetadataSha256": "2" * 64, "sourceDatabase": {"name": "erp", "oid": "42", "systemIdentifier": "90000"},
            "localVerified": True, "remoteVerified": True, "localRestoreVerified": True,
        }
        private_write(self.root / "coordination/deployment-checkpoint.json", json.dumps(self.checkpoint).encode())
        self.stage = json.dumps({"ok": True, "roleCutover": {
            "format": "sabalan-predecessor-role-acl-cutover-v1", "outcome": "staged",
            "deploymentId": self.session["deploymentId"], "releaseId": self.session["releaseId"],
            "controlImage": GRAPH["backend"], "checkpointSha256": self.checkpoint["checksum"],
            "checkpointMetadataSha256": "2" * 64, "sourceDatabase": {"name": "erp", "oid": "42", "systemIdentifier": "90000"},
            "catalogSha256": "3" * 64, "migrationSha256": "4" * 64,
            "preimageSha256": "5" * 64, "stagedAclSha256": "6" * 64,
            "migrations": 477, "tables": 571, "views": 1, "sequences": 5, "securityDefinerRoutines": 5,
        }}).encode()
        self.boundary_calls = []

    def write_phase(self, phase):
        self.session["phase"] = phase
        private_write(self.root / "reports/active-deployment-session.json", json.dumps(self.session).encode())

    def verify_boundary(self, session, checkpoint, stage_receipt):
        self.assertEqual(session, self.session)
        self.assertEqual(checkpoint, self.checkpoint)
        self.assertEqual(stage_receipt, self.stage if session["phase"] == "MUTATION_STARTED" else None)
        self.boundary_calls.append(session["phase"])
        return True

    def observe(self, environment):
        target = environment == TARGET
        self.assertIn(environment, (ORIGINAL, TARGET))
        services = {name: {"image": image, "environment": {}} for name, image in GRAPH.items()}
        services["backend"]["environment"]["DATABASE_URL"] = RUNTIME_URL if target else CONTROL_URL
        services["deployment"] = {"image": GRAPH["backend"], "environment": {
            "DATABASE_URL": CONTROL_URL,
            "DEPLOYMENT_CHECKPOINT_RUNTIME_USER": "sabalan_application_runtime" if target else "owner",
        }}
        services["postgres"]["environment"].update(POSTGRES_USER="owner", POSTGRES_PASSWORD="original-secret", POSTGRES_DB="erp")
        return {"name": "sabalanerp", "services": services}, GRAPH, CONTROL_URL

    @contextlib.contextmanager
    def owner(self, *, sealed=True, lock=True):
        lock_fd = os.open(self.lock, os.O_RDWR)
        if lock_fd != 9:
            os.dup2(lock_fd, 9)
            os.close(lock_fd)

        if lock:
            subprocess.run(["flock", "-n", "9"], check=True, pass_fds=(9,))
        credential = os.memfd_create("runtime-credential", os.MFD_ALLOW_SEALING)
        try:
            os.write(credential, PASSWORD)
            if sealed:
                fcntl.fcntl(credential, fcntl.F_ADD_SEALS, roles.REQUIRED_CREDENTIAL_SEALS)
            yield credential
        finally:
            os.close(credential)
            os.close(9)

    def transaction(self, credential=None, *, observe=None, verify_boundary=None):
        paths = (self.root, self.env, self.root / "reports", self.root / "coordination")
        options = {"observe": observe or self.observe, "verify_boundary": verify_boundary or self.verify_boundary}
        if credential is None:
            return roles.restore(*paths, **options)
        return roles.apply(*paths, credential, self.stage, **options)

    def test_same_images_change_only_runtime_and_restore_exact_bytes(self):
        with self.owner() as credential:
            applied = self.transaction(credential)
            self.assertEqual(self.env.read_bytes(), TARGET)
            self.assertEqual(applied["state"], "APPLIED")
            self.assertEqual(applied["stageReceiptSha256"], hashlib.sha256(self.stage).hexdigest())
            self.write_phase("ROLLBACK_STARTED")
            restored = self.transaction()
            self.assertEqual(restored["state"], "RESTORED")
            self.assertEqual(self.env.read_bytes(), ORIGINAL)
            self.assertEqual(self.transaction(), restored)
        receipts = list((self.root / ".deploy-state").glob("*/receipt.json"))
        self.assertEqual(len(receipts), 1)
        receipt_bytes = receipts[0].read_bytes()
        self.assertEqual(json.loads(receipt_bytes), restored)
        for value in (PASSWORD, b"original-secret", self.session["leaseToken"].encode()):
            self.assertNotIn(value, receipt_bytes)
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)


    def test_transfers_only_sealed_credential_and_exact_staged_binding(self):
        def invoke(frame):
            staged_hash = json.loads(self.stage)["roleCutover"]["stagedAclSha256"]
            self.assertEqual(frame, staged_hash.encode() + PASSWORD)
            marker = self.root / ".deploy-state/predecessor-role-cutover-active.json"
            binding = marker.read_bytes()
            self.assertEqual(json.loads(binding)["stagedAclSha256"], staged_hash)
            self.assertNotIn(PASSWORD, binding)
            return {"ok": True, "roleCutover": {
                **json.loads(self.stage)["roleCutover"], "outcome": "login-activated",
            }}

        paths = (self.root, self.root / "reports", self.root / "coordination")
        with self.owner(sealed=False) as credential:
            with self.assertRaises(roles.RoleHostConfigurationError):
                roles.activate_login(*paths, credential, self.stage, invoke=invoke)
        with self.owner() as credential:
            proof = roles.activate_login(*paths, credential, self.stage, invoke=invoke)
            self.assertEqual(proof["roleCutover"]["outcome"], "login-activated")
            self.assertNotIn(PASSWORD, json.dumps(proof).encode())
        self.assertEqual(self.env.read_bytes(), ORIGINAL)

    def test_restore_if_receipt_publication_fails_after_env_replacement(self):
        receipt = self.root / ".deploy-state" / ("predecessor-role-host-" + self.session["deploymentId"]) / "receipt.json"
        receipt.parent.mkdir(mode=0o700)
        receipt.mkdir(mode=0o700)
        with self.owner() as credential:
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction(credential)
            self.assertEqual(self.env.read_bytes(), TARGET)
            receipt.rmdir()
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction()
            self.assertEqual(self.env.read_bytes(), TARGET)
            self.write_phase("ROLLBACK_STARTED")
            self.assertEqual(self.transaction()["state"], "RESTORED")
            self.assertEqual(self.env.read_bytes(), ORIGINAL)

    def test_rejects_unsealed_credentials_unlocked_fd_and_changed_stage_receipt(self):
        with self.owner(sealed=False) as credential:
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction(credential)
        with self.owner(lock=False) as credential:
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction(credential)
        self.stage = self.stage.replace(b"90000", b"90001")
        with self.owner() as credential:
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction(credential)
        self.assertEqual(self.env.read_bytes(), ORIGINAL)

    def test_rejects_control_url_or_immutable_image_drift(self):
        def slipped_control_url(environment):
            model, graph, installed = self.observe(environment)
            if environment == TARGET:
                model["services"]["deployment"]["environment"]["DATABASE_URL"] = RUNTIME_URL
            return model, graph, installed

        def slipped_image(environment):
            model, graph, installed = self.observe(environment)
            model["services"]["inquiry"]["image"] = "inquiry:mutable"
            return model, graph, installed

        with self.owner() as credential:
            for observe in (slipped_control_url, slipped_image):
                with self.subTest(observe=observe.__name__), self.assertRaises(roles.RoleHostConfigurationError):
                    self.transaction(credential, observe=observe)
                self.assertEqual(self.env.read_bytes(), ORIGINAL)

    def test_restore_refuses_rendered_baseline_drift(self):
        def changed_baseline(environment):
            model, graph, installed = self.observe(environment)
            model["services"]["nginx"]["environment"]["CHANGED"] = "yes"
            return model, graph, installed

        with self.owner() as credential:
            self.transaction(credential)
            self.write_phase("ROLLBACK_STARTED")
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction(observe=changed_baseline)
            self.assertEqual(self.env.read_bytes(), TARGET)

    def test_restore_refuses_environment_or_checkpoint_drift(self):
        with self.owner() as credential:
            self.transaction(credential)
            self.write_phase("ROLLBACK_STARTED")
            drift = TARGET + b"ADDED=1\n"
            private_write(self.env, drift)
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction()
            self.assertEqual(self.env.read_bytes(), drift)
            private_write(self.env, TARGET)
            self.checkpoint["checksum"] = "e" * 64
            private_write(self.root / "coordination/deployment-checkpoint.json", json.dumps(self.checkpoint).encode())
            with self.assertRaises(roles.RoleHostConfigurationError):
                self.transaction()
            self.assertEqual(self.env.read_bytes(), TARGET)


if __name__ == "__main__":
    unittest.main()

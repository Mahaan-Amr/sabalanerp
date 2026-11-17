import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[2] / "deploy/scripts/predecessor-role-host-configuration.py"
SPEC = importlib.util.spec_from_file_location("role_configuration", MODULE)
roles = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(roles)
NATIVE_SPEC = importlib.util.spec_from_file_location("role_native", MODULE.with_name("predecessor-role-cutover-native.py"))
native = importlib.util.module_from_spec(NATIVE_SPEC)
NATIVE_SPEC.loader.exec_module(native)
CANONICAL_SPEC = importlib.util.spec_from_file_location("role_canonical", MODULE.with_name("predecessor-role-cutover-canonical.py"))
canonical = importlib.util.module_from_spec(CANONICAL_SPEC)
CANONICAL_SPEC.loader.exec_module(canonical)
TERMINAL_SPEC = importlib.util.spec_from_file_location("role_terminal", MODULE.with_name("predecessor-role-cutover-terminal.py"))
terminal = importlib.util.module_from_spec(TERMINAL_SPEC)
TERMINAL_SPEC.loader.exec_module(terminal)

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
            "preservedClamav": {"selection": {"image": GRAPH["clamav"]}, "selectionSha256": "7" * 64},
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

    def test_recreate_pinned_backend_and_prove_exact_runtime_and_rollback(self):
        original = {name: str(i) * 64 for i, name in enumerate(SERVICES, 1)}
        backend_id = original["backend"]
        installed = CONTROL_URL
        running = False
        calls = []
        signed_role_is_correct = False
        nginx_replaced = False

        def inspect():
            rows = []
            for name, image in GRAPH.items():
                identifier = backend_id if name == "backend" else original[name]
                if nginx_replaced and name == "nginx":
                    identifier = "d" * 64
                rows.append({
                    "Id": identifier, "Image": image, "Created": "2026-11-17T00:00:00Z",
                    "State": {"Running": running if name == "backend" else True,
                              "Health": {"Status": "healthy"}, "StartedAt": "2000-01-01", "Pid": 7,
                              "Restarting": False, "Dead": False},
                    "Config": {"Hostname": identifier[:12], "Env": ["DATABASE_URL=" + installed] if name == "backend" else [],
                               "Labels": {"com.docker.compose.service": name, "com.docker.compose.project": "sabalanerp"}},
                    "HostConfig": {}, "Mounts": [], "NetworkSettings": {"Networks": {
                        "sabalanerp_app_network": {"NetworkID": "f" * 64, "IPAddress": "172.24.0.5"},
                    }},
                })
            return rows

        def recreate_backend(command):
            nonlocal backend_id, installed, running
            calls.append(command)
            self.assertEqual(command, ("up", "-d", "--no-deps", "--no-build", "--force-recreate", "--pull", "never",
                                       "--wait", "--wait-timeout", "180", "backend"))
            staged = self.session["phase"] == "MUTATION_STARTED"
            backend_id = ("a" if staged else "b") * 64
            installed = RUNTIME_URL if staged else CONTROL_URL
            running = not staged
            # Simulate an interrupted native apply after the new exact container exists.
            return not staged

        def live_boundary(session, checkpoint):
            self.assertEqual(session, self.session)
            self.assertEqual(checkpoint, self.checkpoint)
            return True

        def prove_role(request):
            return {"role": "sabalan_application_runtime" if signed_role_is_correct and self.session["phase"] == "MUTATION_STARTED" else "owner",
                    "backendId": backend_id, "backendAddress": request["backendAddress"],
                    "deploymentId": self.session["deploymentId"], "checkpointSha256": self.checkpoint["checksum"]}

        def continue_backend():
            return roles.continue_backend(
                self.root, self.env, self.root / "reports", self.root / "coordination", original,
                inspect=inspect, recreate_backend=recreate_backend, verify_boundary=live_boundary, prove_role=prove_role,
            )

        with self.owner() as credential:
            self.transaction(credential)
            with self.assertRaises(roles.RoleHostConfigurationError):
                continue_backend()
            self.assertEqual(len(calls), 1)
            with self.assertRaises(roles.RoleHostConfigurationError):
                continue_backend()
            self.assertEqual(len(calls), 1)
            running = True
            with self.assertRaises(roles.RoleHostConfigurationError):
                continue_backend()
            self.assertEqual(len(calls), 1)
            signed_role_is_correct = True
            applied = continue_backend()
            self.assertEqual(applied["backendId"], "a" * 64)
            self.assertFalse(applied["canOpenTraffic"])
            self.assertEqual(applied["role"], "sabalan_application_runtime")
            self.assertEqual(continue_backend(), applied)
            self.assertEqual(len(calls), 1)

            self.write_phase("ROLLBACK_STARTED")
            self.transaction()
            running = False
            nginx_replaced = True
            with self.assertRaises(roles.RoleHostConfigurationError):
                continue_backend()
            self.assertEqual(len(calls), 1)
            nginx_replaced = False
            restored = continue_backend()
            self.assertEqual(restored["backendId"], "b" * 64)
            self.assertFalse(restored["canOpenTraffic"])
            self.assertEqual(restored["role"], "owner")
            self.assertEqual(self.env.read_bytes(), ORIGINAL)
            self.assertEqual(len(calls), 2)

    def test_foreground_uses_exact_stage_after_a_lost_login_reply_and_rolls_back(self):
        original = {name: str(i) * 64 for i, name in enumerate(SERVICES, 1)}
        plan = {
            "format": "sabalan-predecessor-role-cutover-preflight/v1", "sourceCommit": self.session["targetCommit"],
            "sourceHash": "8" * 64, "browserBuildId": "erp_fixture", "images": GRAPH, "containers": original,
            "preservedClamavSelectionSha256": "7" * 64, "databaseTopology": "legacy", "canMutate": False,
            "canOpenTraffic": False, "planSha256": "9" * 64,
        }
        actual_stage = json.loads(self.stage)["roleCutover"]
        calls = []
        allow_next_step = False
        backend_id = original["backend"]
        installed = CONTROL_URL
        running = False
        address = "172.24.0.5"
        nginx_started = "2026-11-17T00:00:00Z"
        paths = (self.root, self.env, self.root / "reports", self.root / "coordination")

        def control(command, args, stdin):
            calls.append(command)
            if command == "attest-predecessor-backend-runtime":
                self.assertEqual((args, stdin), ((address, backend_id), None))
                return json.dumps({"ok": True, "runtimeProof": {
                    "role": "owner" if installed == CONTROL_URL else "sabalan_application_runtime",
                    "backendId": backend_id, "backendAddress": address, "deploymentId": self.session["deploymentId"],
                    "checkpointSha256": self.checkpoint["checksum"],
                }}).encode()
            self.assertEqual(args, ())
            if command == "stage-predecessor-role-grants":
                self.assertIsNone(stdin)
                return self.stage
            if command == "restore-predecessor-role-grants":
                self.assertIsNone(stdin)
                return json.dumps({"ok": True, "roleCutover": {**actual_stage, "outcome": "restored"}}).encode()
            self.assertEqual(command, "activate-predecessor-runtime-login")
            self.assertEqual(stdin, actual_stage["stagedAclSha256"].encode() + PASSWORD)
            if allow_next_step:
                return json.dumps({"ok": True, "roleCutover": {**actual_stage, "outcome": "login-already-active"}}).encode()
            raise RuntimeError("Native activation reply unavailable")

        def boundary(session, checkpoint):
            self.assertEqual((session, checkpoint), (self.session, self.checkpoint))
            return True

        def inspect():
            rows = []
            for name in SERVICES:
                identifier = backend_id if name == "backend" else original[name]
                rows.append({
                    "Id": identifier, "Image": GRAPH[name], "Created": "2026-11-17",
                    "Config": {"Hostname": identifier[:12], "Env": ["DATABASE_URL=" + installed] if name == "backend" else [],
                               "Labels": {"com.docker.compose.service": name, "com.docker.compose.project": "sabalanerp"}},
                    "HostConfig": {}, "Mounts": [],
                    "State": {"StartedAt": nginx_started if name == "nginx" else "2026-11-17",
                              "Pid": 17, "Health": {"Status": "healthy"},
                              "Running": running if name == "backend" else True, "Restarting": False, "Dead": False},
                    "NetworkSettings": {"Networks": {"app_network": {"IPAddress": address}}},
                })
            return rows

        def recreate(command):
            nonlocal backend_id, installed, running
            self.assertEqual(command[-1], "backend")
            calls.append("recreate")
            running = True
            rollback = self.session["phase"] == "ROLLBACK_STARTED"
            backend_id = ("b" if rollback else "a") * 64
            installed = CONTROL_URL if rollback else RUNTIME_URL
            return True

        def foreground(credential):
            return roles.foreground(
                *paths, plan, credential, control=control, verify_boundary=boundary, observe=self.observe,
                inspect=inspect, recreate_backend=recreate,
            )

        with self.owner() as credential:
            with self.assertRaises(roles.RoleHostConfigurationError):
                foreground(credential)
            self.assertEqual(calls, ["stage-predecessor-role-grants", "activate-predecessor-runtime-login"])
            self.assertEqual(self.env.read_bytes(), ORIGINAL)
            drifted = ORIGINAL + b"\nUNRELATED=drift\n"
            private_write(self.env, drifted)
            with self.assertRaises(roles.RoleHostConfigurationError):
                foreground(credential)
            self.assertEqual(calls, ["stage-predecessor-role-grants", "activate-predecessor-runtime-login"])
            self.assertEqual(self.env.read_bytes(), drifted)
            private_write(self.env, ORIGINAL)
            allow_next_step = True
            target = foreground(credential)
            self.assertEqual(target["role"], "sabalan_application_runtime")
            self.assertEqual(calls, ["stage-predecessor-role-grants", "activate-predecessor-runtime-login",
                                     "activate-predecessor-runtime-login", "recreate", "attest-predecessor-backend-runtime"])
            self.assertEqual(self.env.read_bytes(), TARGET)
            self.assertFalse(target["canOpenTraffic"])
            proxy_calls = []

            def failed_refresh(identifier):
                proxy_calls.append(identifier)
                return False

            proxy_args = (self.root, self.root / "reports", self.root / "coordination",
                          self.session["phase"], target, original["nginx"])
            options = {"inspect": inspect, "renewal": boundary, "maintenance": lambda: True,
                       "restart": failed_refresh, "wait_for_healthy": lambda: None}
            with self.assertRaises(canonical.host.RoleHostConfigurationError):
                canonical.refresh_original_nginx(*proxy_args, **options)
            with self.assertRaises(canonical.host.RoleHostConfigurationError):
                canonical.refresh_original_nginx(*proxy_args, **options)
            self.assertEqual(proxy_calls, [original["nginx"]])
            nginx_started = "2026-11-17T00:02:00Z"
            proxy = canonical.refresh_original_nginx(*proxy_args, **options)
            self.assertEqual(proxy["nginxId"], original["nginx"])
            self.assertEqual(proxy["refreshedStartedAt"], nginx_started)
            self.assertFalse(proxy["canOpenTraffic"])
            self.assertEqual(proxy_calls, [original["nginx"]])

            self.write_phase("ROLLBACK_STARTED")
            running = False
            prior = foreground(None)
            self.assertEqual(prior["role"], "owner")
            self.assertEqual(calls[-3:], ["restore-predecessor-role-grants", "recreate", "attest-predecessor-backend-runtime"])
            self.assertEqual(self.env.read_bytes(), ORIGINAL)
            self.assertFalse(prior["canOpenTraffic"])

    def test_foreground_rollback_recovers_owned_stage_if_native_reply_was_lost(self):
        ids = {name: str(i) * 64 for i, name in enumerate(SERVICES, 1)}
        plan = {
            "format": "sabalan-predecessor-role-cutover-preflight/v1", "sourceCommit": self.session["targetCommit"],
            "sourceHash": "8" * 64, "browserBuildId": "erp_fixture", "images": GRAPH, "containers": ids,
            "preservedClamavSelectionSha256": "7" * 64, "databaseTopology": "legacy", "canMutate": False,
            "canOpenTraffic": False, "planSha256": "9" * 64,
        }
        stage = json.loads(self.stage)["roleCutover"]
        called = []

        def control(command, args, stdin):
            called.append(command)
            self.assertIsNone(stdin)
            if command == "stage-predecessor-role-grants":
                raise RuntimeError("Committed in the fixture but no stdout was received")
            if command == "restore-predecessor-role-grants":
                return json.dumps({"ok": True, "roleCutover": {**stage, "outcome": "restored"}}).encode()
            self.assertEqual(command, "attest-predecessor-backend-runtime")
            return json.dumps({"ok": True, "runtimeProof": {
                "deploymentId": self.session["deploymentId"], "checkpointSha256": self.checkpoint["checksum"],
                "backendAddress": "172.22.0.5", "backendId": ids["backend"], "role": "owner",
            }}).encode()

        def inspect():
            return [{
                "Id": ids[name], "Created": "2026-11-17", "Image": GRAPH[name],
                "Config": {"Hostname": ids[name][:12], "Env": ["DATABASE_URL=" + CONTROL_URL] if name == "backend" else [],
                           "Labels": {"com.docker.compose.service": name, "com.docker.compose.project": "sabalanerp"}},
                "HostConfig": {}, "Mounts": [],
                "State": {"StartedAt": "2026-11-17", "Pid": 5, "Health": {"Status": "healthy"},
                          "Running": True, "Restarting": False, "Dead": False},
                "NetworkSettings": {"Networks": {"app_network": {"IPAddress": "172.22.0.5"}}},
            } for name in SERVICES]

        def foreground(credential):
            return roles.foreground(
                self.root, self.env, self.root / "reports", self.root / "coordination", plan, credential,
                control=control, verify_boundary=lambda session, checkpoint: (session, checkpoint) == (self.session, self.checkpoint),
                observe=self.observe, inspect=inspect, recreate_backend=lambda command: self.fail("The exact original backend serves"),
            )

        with self.owner() as credential:
            with self.assertRaises(roles.RoleHostConfigurationError):
                foreground(credential)
            self.assertEqual(called, ["stage-predecessor-role-grants"])
            self.write_phase("ROLLBACK_STARTED")
            result = foreground(None)
            self.assertEqual(result["backendId"], ids["backend"])
            self.assertFalse(result["canOpenTraffic"])
            self.assertEqual(self.env.read_bytes(), ORIGINAL)
            self.assertEqual(called, ["stage-predecessor-role-grants", "restore-predecessor-role-grants",
                                      "attest-predecessor-backend-runtime"])

    def test_native_child_inherits_lock_and_retains_only_redacted_closure_evidence(self):
        raw = b"6" * 64 + PASSWORD
        command = (sys.executable, "-c",
                   "import os, sys, time; assert os.readlink('/proc/self/fd/9').endswith('/deployment.lock');"
                   "data = sys.stdin.buffer.read(); assert len(data) == 107;"
                   "sys.stderr.buffer.write(data); time.sleep(0.12); print('safe acknowledgement')")
        calls = []

        def renewal(session, checkpoint):
            self.assertEqual((session, checkpoint), (self.session, self.checkpoint))
            calls.append(1)
            return True

        with self.owner():
            stdout, receipt = native.run_native_child(
                self.root, self.root / "reports", self.root / "coordination",
                "MUTATION_STARTED", "activate-predecessor-runtime-login", command,
                stdin=raw, renewal=renewal, budget_seconds=2, heartbeat_seconds=0.03,
            )
        self.assertEqual(stdout.strip(), b"safe acknowledgement")
        self.assertGreaterEqual(len(calls), 3)
        self.assertTrue(receipt["childClosed"])
        self.assertTrue(receipt["stdoutClosed"])
        self.assertTrue(receipt["stderrClosed"])
        self.assertFalse(receipt["canOpenTraffic"])
        self.assertEqual(receipt["outcome"], "CLOSED")
        files = list((self.root / ".deploy-state").glob("**/native-*.json"))
        self.assertEqual(len(files), 2)
        self.assertTrue(all(PASSWORD not in item.read_bytes() for item in files))

    def test_native_child_keeps_heartbeat_after_failure_until_descendant_pipe_eof(self):
        marker = self.root / "native-closed.txt"
        command = (sys.executable, "-c",
                   "import subprocess, sys; subprocess.Popen([sys.executable, '-c',"
                   "'import time, pathlib, sys; time.sleep(0.15); pathlib.Path(sys.argv[1]).touch()', sys.argv[1]])",
                   str(marker))
        calls = []

        def renewal(session, checkpoint):
            calls.append(marker.exists())
            return len(calls) != 2

        with self.owner():
            with self.assertRaises(native.ProtectedNativeChildError):
                native.run_native_child(
                    self.root, self.root / "reports", self.root / "coordination",
                    "MUTATION_STARTED", "stage-predecessor-role-grants", command,
                    renewal=renewal, budget_seconds=0.05, heartbeat_seconds=0.02,
                )
        self.assertTrue(marker.exists())
        self.assertGreaterEqual(len(calls), 3)
        status = list((self.root / ".deploy-state").glob("**/native-*-result.json"))
        self.assertEqual(len(status), 1)
        receipt = json.loads(status[0].read_bytes())
        self.assertEqual(receipt["outcome"], "HELD")
        self.assertTrue(receipt["deadlineExceeded"])
        self.assertTrue(receipt["heartbeatFailed"])
        self.assertTrue(receipt["stdoutClosed"] and receipt["stderrClosed"] and receipt["childClosed"])
        self.assertFalse(receipt["canOpenTraffic"])

    def test_canonical_transport_reuses_original_control_image_and_lease_heartbeat(self):
        binary = self.root / "bin"
        binary.mkdir()
        fake = binary / "docker"
        log = self.root / "native-docker-arguments.jsonl"
        compose = self.root / "docker-compose.prod.yml"
        compose.write_text("name: sabalanerp\n")
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "args = sys.argv[1:]\n"
            "with open(os.environ['ROLE_FIXTURE_LOG'], 'a') as out:\n"
            " out.write(json.dumps({'args': args, 'selectedImage': os.environ.get('DEPLOYMENT_BACKEND_IMAGE')}) + '\\n')\n"
            "if 'exec' in args: print('1')\n"
        )
        fake.chmod(0o700)
        exports = {
            "PATH": str(binary) + ":" + os.environ["PATH"], "ROLE_FIXTURE_LOG": str(log),
            "DEPLOYMENT_ID": self.session["deploymentId"], "DEPLOYMENT_RELEASE_ID": self.session["releaseId"],
            "DEPLOYMENT_MODE": "configuration", "DEPLOYMENT_TARGET_COMMIT": self.session["targetCommit"],
            "DEPLOYMENT_TARGET_BACKEND_IMAGE": GRAPH["backend"], "DEPLOYMENT_OWNER": self.session["owner"],
            "DEPLOYMENT_CLAMAV_REPAIR": "false", "DEPLOYMENT_CLAMAV_OPERATION": "repair",
            "DEPLOYMENT_CLAMAV_TARGET_IMAGE": "", "DEPLOYMENT_BACKEND_IMAGE": GRAPH["backend"],
            "DEPLOYMENT_LEASE_TOKEN": self.session["leaseToken"], "DEPLOYMENT_PHASE": "MUTATION_STARTED",
            "ADVISORY_PID": str(os.getpid()), "ADVISORY_LOCK_KEY": "741936425",
            "ADVISORY_APPLICATION_NAME": "sabalan-lock-" + self.session["deploymentId"],
        }
        exports.update({"DEPLOYMENT_PREVIOUS_" + key.upper() + "_IMAGE": image for key, image in GRAPH.items()})
        with self.owner(), patch.dict(os.environ, exports):
            control = canonical.canonical_shell(self.env, compose, "control", "stage-predecessor-role-grants")
            self.assertTrue(canonical.held_owner_command(self.root, control))
            self.assertTrue(canonical.held_owner_command(self.root, canonical.canonical_shell(self.env, compose, "renewal")))
        observations = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual(len(observations), 3)
        self.assertEqual(observations[0]["selectedImage"], GRAPH["backend"])
        self.assertIn("--pull=never", observations[0]["args"])
        self.assertEqual(observations[0]["args"][-4:],
                         ["deployment", "node", "dist/scripts/deployment-control.js", "stage-predecessor-role-grants"])
        self.assertIn("exec", observations[1]["args"])
        self.assertIn("741936425", observations[1]["args"][-1])
        self.assertEqual(observations[2]["args"][-4:], ["deployment", "node", "dist/scripts/deployment-control.js", "heartbeat"])

    def test_native_signal_cannot_detach_a_mutating_child_or_authorize_output(self):
        marker = self.root / "native-signal-closed.txt"
        command = (sys.executable, "-c",
                   "import os, signal, time, pathlib, sys; os.kill(os.getppid(), signal.SIGTERM);"
                   "time.sleep(0.12); pathlib.Path(sys.argv[1]).touch(); print('no release authorization')",
                   str(marker))
        with self.owner():
            with self.assertRaises(native.ProtectedNativeChildError):
                native.run_native_child(
                    self.root, self.root / "reports", self.root / "coordination",
                    "MUTATION_STARTED", "recreate-backend", command, renewal=lambda session, point: True,
                    budget_seconds=2, heartbeat_seconds=0.03,
                )
        self.assertTrue(marker.exists())
        result = list((self.root / ".deploy-state").glob("**/native-*-result.json"))
        self.assertEqual(len(result), 1)
        receipt = json.loads(result[0].read_bytes())
        self.assertTrue(receipt["interruptSignals"])
        self.assertTrue(receipt["childClosed"])
        self.assertEqual(receipt["outcome"], "HELD")
        self.assertFalse(receipt["canOpenTraffic"])

    def test_gate_acknowledgement_requires_current_runtime_proxy_and_owned_native_report(self):
        with self.owner():
            for phase, state, mode, count in (
                ("MUTATION_STARTED", "APPLIED", "PREDECESSOR_ROLE_APPLIED", 19),
                ("ROLLBACK_STARTED", "RESTORED", "PREDECESSOR_ROLE_ROLLBACK", 16),
            ):
                with self.subTest(phase=phase):
                    self.write_phase(phase)
                    identity = {"deploymentId": self.session["deploymentId"], "checkpointSha256": self.checkpoint["checksum"],
                                "backendId": "a" * 64, "canOpenTraffic": False}
                    proof = {**identity, "state": state}
                    _, _, binding = canonical.host.context(self.root, self.root / "reports", self.root / "coordination", phase)
                    private, _ = canonical.host.transaction_paths(self.root, binding["deploymentId"])
                    role_raw = canonical.host.json_bytes(proof)
                    private_write(private.with_name("backend-runtime-" + state.lower() + "-proof.json"), role_raw)
                    nginx = {**identity, "nginxId": "e" * 64, "roleProofSha256": canonical.host.digest(role_raw)}
                    private_write(private.with_name("nginx-" + state.lower() + "-proof.json"), canonical.host.json_bytes(nginx))
                    gate_rows = [{"name": "gate-" + str(i), "passed": True} for i in range(count - 1)]
                    gate_rows.append({"name": "checkpoint-manifest", "passed": True,
                                      "details": {"checksum": self.checkpoint["checksum"], "remoteReadBack": True,
                                                  "releaseId": self.session["releaseId"]}})
                    report = {"format": "sabalan-deployment-report", "version": 1, "mode": mode,
                              "deploymentId": self.session["deploymentId"], "releaseId": self.session["releaseId"],
                              "targetCommit": self.session["targetCommit"], "gates": gate_rows}
                    name = self.session["deploymentId"] + (".rollback" if state == "RESTORED" else "") + ".json"
                    report_file = self.root / "reports" / name
                    report_raw = canonical.host.json_bytes(report)
                    private_write(report_file, report_raw)
                    closure = {"format": "sabalan-predecessor-role-native-result/v1", **identity,
                               "outcome": "CLOSED", "action": "deployment-gates", "phase": phase,
                               "attemptId": ("1" if state == "APPLIED" else "2") * 32,
                               "childClosed": True, "stdoutClosed": True, "stderrClosed": True}
                    closure_file = private.with_name("native-" + closure["attemptId"] + "-result.json")
                    private_write(closure_file, canonical.host.json_bytes(closure))

                    def gates(selected):
                        self.assertEqual(selected, mode)
                        return json.dumps({"ok": True, "reportPath": "/app/deployment-reports/" + name,
                                           "gates": gate_rows}).encode(), closure

                    def acknowledge(verify_current):
                        return canonical.acknowledge_role_gates(
                            self.root, self.root / "reports", self.root / "coordination", phase, proof, nginx,
                            gates=gates, verify_current=verify_current, renewal=lambda session, point: True,
                            maintenance=lambda: True,
                        )

                    with self.assertRaises(canonical.host.RoleHostConfigurationError):
                        acknowledge(lambda: False)
                    report["targetCommit"] = "2" * 40
                    private_write(report_file, canonical.host.json_bytes(report))
                    with self.assertRaises(canonical.host.RoleHostConfigurationError):
                        acknowledge(lambda: True)
                    private_write(report_file, report_raw)
                    ack = acknowledge(lambda: True)
                    self.assertEqual(ack["gateMode"], mode)
                    self.assertEqual(ack["gateCount"], count)
                    self.assertFalse(ack["canOpenTraffic"])
                    self.assertEqual(ack["gateReportSha256"], hashlib.sha256(report_raw).hexdigest())

    def test_unknown_open_does_not_replay_and_terminal_readback_archives_both_holds(self):
        reports, coordination = self.root / "reports", self.root / "coordination"
        source_marker = coordination / "deployment-maintenance.json"
        calls = []
        with self.owner():
            _, _, binding = terminal.host.context(self.root, reports, coordination, "MUTATION_STARTED")
            private, _ = terminal.host.transaction_paths(self.root, binding["deploymentId"])
            gate = {"format": "sabalan-predecessor-role-gate-acknowledgement-v1", **binding, "state": "APPLIED",
                    "canOpenTraffic": False, "gateMode": "PREDECESSOR_ROLE_APPLIED", "gateCount": 19,
                    **{key: "9" * 64 for key in ("gateReportSha256", "roleProofSha256", "nginxProofSha256",
                                                 "nativeClosureSha256", "backendId", "nginxId")}}
            private_write(private.with_name("role-gates-applied-acknowledgement.json"), terminal.host.json_bytes(gate))
            holds = (self.root / ".deploy-state" / terminal.HOLD, reports / terminal.HOLD)
            for hold in holds:
                private_write(hold, terminal.host.json_bytes(binding))

            def interrupted_open(intent):
                calls.append(intent)
                self.assertTrue((reports / terminal.OPEN_INTENT).exists())
                source_marker.unlink()
                return False

            retained = {"authorise": lambda session, point, ack: ack == gate, "remove_maintenance": interrupted_open,
                        "renew_without_marker": lambda session, intent: True, "observe_public": lambda expected: expected}
            with self.assertRaises(terminal.host.RoleHostConfigurationError):
                terminal.open_owned_traffic(self.root, reports, coordination, "MUTATION_STARTED", gate,
                                            ("erp.fixture.test", "inquiry.fixture.test"), **retained)
            with self.assertRaises(terminal.host.RoleHostConfigurationError):
                terminal.open_owned_traffic(self.root, reports, coordination, "MUTATION_STARTED", gate,
                                            ("erp.fixture.test", "inquiry.fixture.test"), **retained)
            self.assertEqual(len(calls), 1)
            self.assertTrue(all(hold.exists() for hold in holds))

            visible = terminal.observe_open_owned_traffic(
                self.root, reports, coordination, binding["deploymentId"],
                renew_without_marker=retained["renew_without_marker"], observe_public=retained["observe_public"],
            )
            self.assertEqual(visible["origins"], {"erp.fixture.test": 200, "inquiry.fixture.test": 200})
            (reports / terminal.SESSION).unlink()
            with self.assertRaises(terminal.host.RoleHostConfigurationError):
                terminal.archive_terminal_holds(
                    self.root, reports, coordination, binding["deploymentId"],
                    read_terminal=lambda expected: {**expected, "activeLeases": 1}, observe_public=lambda expected: expected,
                )
            self.assertTrue(all(hold.exists() for hold in holds))
            archived = terminal.archive_terminal_holds(
                self.root, reports, coordination, binding["deploymentId"],
                read_terminal=lambda expected: expected, observe_public=lambda expected: expected,
            )
            self.assertEqual(archived["phase"], "COMPLETED")
            self.assertTrue(all(not hold.exists() for hold in holds))
            self.assertFalse((reports / terminal.OPEN_INTENT).exists())
            self.assertEqual(archived, terminal.archive_terminal_holds(
                self.root, reports, coordination, binding["deploymentId"],
                read_terminal=lambda expected: expected, observe_public=lambda expected: expected,
            ))

    def test_native_terminal_open_can_observe_owned_marker_disappearance(self):
        reports, coordination = self.root / "reports", self.root / "coordination"
        marker = coordination / terminal.MAINTENANCE
        command = (sys.executable, "-c",
                   "import os, sys, pathlib; assert os.readlink('/proc/self/fd/9').endswith('/deployment.lock');"
                   "pathlib.Path(sys.argv[1]).unlink(); print('native marker removed')", str(marker))
        with self.owner():
            authority = native.configuration.context(self.root, reports, coordination, "MUTATION_STARTED")
            observed = []

            def terminal_probe():
                observed.append(marker.exists())
                self.assertEqual(json.loads((reports / terminal.SESSION).read_bytes()), self.session)
                return authority

            stdout, closure = native.run_native_child(
                self.root, reports, coordination, "MUTATION_STARTED", "open-predecessor-role-terminal",
                command, renewal=lambda session, checkpoint: (session, checkpoint) == authority[:2],
                terminal_probe=terminal_probe, heartbeat_seconds=0.03, budget_seconds=2,
            )
            self.assertEqual(stdout.strip(), b"native marker removed")
            self.assertTrue(observed[0])
            self.assertIn(False, observed)
            self.assertEqual(closure["outcome"], "CLOSED")
            self.assertFalse(closure["canOpenTraffic"])
            with self.assertRaises(native.ProtectedNativeChildError):
                native.run_native_child(
                    self.root, reports, coordination, "MUTATION_STARTED", "stage-predecessor-role-grants",
                    command, renewal=lambda *_: True, terminal_probe=terminal_probe,
                )

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

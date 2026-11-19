"""QA-only recovery proof with a retained, nonblocking advisory session."""

from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import stat
import subprocess
import sys
import time
import uuid


ADVISORY_KEY = 741936425
DIRECTORY = Path(__file__).resolve().parent
DB = ("docker", "exec", "-i", "sabalanerp-postgres-1", "sh", "-c",
      'exec psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres')


def require(condition):
    if not condition:
        raise RuntimeError("QA_INTERRUPTED_ROLE_OWNER_UNPROVEN")


def query(sql):
    return subprocess.check_output(DB, input=sql + ";\n", text=True, timeout=8,
                                   stderr=subprocess.DEVNULL).strip()


@contextmanager
def recovery_advisory(deployment_id, *, canonical_label=False):
    operation_hash = hashlib.sha256(deployment_id.encode()).hexdigest()[:16]
    name = "sabalan-qa-recovery-" + operation_hash + "-" + uuid.uuid4().hex[:16]
    if canonical_label:
        name = "sabalan-lock-" + deployment_id
        require(len(name.encode("ascii")) <= 63 and all(c.isalnum() or c in "-_" for c in name))
    command = subprocess.Popen(DB, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL)
    try:
        command.stdin.write(f"WITH named AS MATERIALIZED (SELECT set_config('application_name','{name}',false)) "
                            f"SELECT pg_backend_pid()::text || '|' || pg_try_advisory_lock({ADVISORY_KEY})::text FROM named;\n")
        command.stdin.flush()
        require(bool(select.select([command.stdout], [], [], 8)[0]))
        answer = command.stdout.readline().strip().split("|")
        require(len(answer) == 2 and answer[0].isdigit() and answer[1] == "true")
        postgres_pid = int(answer[0])
        observation = ("FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE l.locktype='advisory'"
                       f" AND l.classid=0 AND l.objid={ADVISORY_KEY} AND l.objsubid=1 AND l.granted")
        require(query("SELECT count(*) " + observation) == "1")
        require(query("SELECT count(*) " + observation +
                      f" AND a.pid={postgres_pid} AND a.application_name='{name}' AND a.datname='postgres'") == "1")
        yield {"databasePid": postgres_pid, "clientPid": command.pid, "applicationName": name}
    finally:
        command.stdin.close()
        require(command.wait(timeout=10) == 0)
    require(query("SELECT count(*) FROM pg_locks"
                  f" WHERE locktype='advisory' AND classid=0 AND objid={ADVISORY_KEY} AND objsubid=1"
                  f" AND pid={postgres_pid}") == "0")


def inspect_evidence(plan, digest, environment):
    proof = json.loads(subprocess.check_output(
        ["node", str(DIRECTORY / "qa-interrupted-role-proof.mjs"), plan, digest, environment],
        encoding="utf8", timeout=60, stderr=subprocess.DEVNULL, pass_fds=(9,)))
    require(proof["format"] == "sabalan-qa-interrupted-role-evidence/v1")
    return proof


def prove_owner(plan, digest, environment):
    proof = inspect_evidence(plan, digest, environment)
    with recovery_advisory(proof["deploymentId"]):
        pass
    return {**proof, "advisoryOwnershipProven": True, "advisoryReleased": True}


def load_canonical_owner():
    spec = importlib.util.spec_from_file_location("role_canonical", DIRECTORY / "predecessor-role-cutover-canonical.py")
    canonical = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(canonical)
    return canonical


def native_runtime_closed(coordination):
    lock = coordination / "deployment-runtime-control.lock"
    fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Rebind FD9 in this child only. The recovery parent retains the host lock.
        command = (sys.executable, "-B", "-c",
                   "import os,sys; os.dup2(int(sys.argv[1]),9); os.execv(sys.executable,[sys.executable,*sys.argv[2:]])",
                   str(fd), "-B", str(DIRECTORY / "backend-runtime-owner.py"), "--assert-closed")
        subprocess.run(command, env={**os.environ, "RECOVERY_COORDINATION_DIR": str(coordination),
                                     "BACKEND_CONTROL_LOCK_FD": "9", "BACKEND_CONTROL_LOCK_FILE": str(lock)},
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       pass_fds=(fd,), check=True, timeout=15)
    finally:
        os.close(fd)


def recovery_environment(session, serving, holder, plan, plan_sha):
    graph = session["rollbackReleaseSet"]
    require(serving["APP_COMMIT"] == session["targetCommit"])
    require(set(serving) == {
        "APP_COMMIT", "DEPLOYMENT_RELEASE_ID", "PERFORMANCE_RELEASE_BACKEND_IMAGE", "PERFORMANCE_RELEASE_COMMIT",
        "PERFORMANCE_RELEASE_FRONTEND_IMAGE", "PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH",
        "PERFORMANCE_RELEASE_INQUIRY_IMAGE", "PERFORMANCE_RELEASE_POLICY_HASH", "PERFORMANCE_RELEASE_SCHEMA_HASH",
        "PERFORMANCE_RELEASE_SOURCE_HASH", "PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH",
    })
    values = {**serving, "COMPOSE_PROJECT_NAME": "sabalanerp", "DOCKER_HOST": "unix:///var/run/docker.sock",
              "DEPLOYMENT_MODE": "configuration", "DEPLOYMENT_ID": session["deploymentId"],
              "DEPLOYMENT_RELEASE_ID": session["releaseId"], "DEPLOYMENT_OWNER": session["owner"],
              "DEPLOYMENT_LEASE_TOKEN": session["leaseToken"], "DEPLOYMENT_TARGET_COMMIT": session["targetCommit"],
              "DEPLOYMENT_PHASE": "MUTATION_STARTED", "DEPLOYMENT_TARGET_BACKEND_IMAGE": graph["backend"],
              "DEPLOYMENT_CLAMAV_REPAIR": "false", "DEPLOYMENT_CLAMAV_OPERATION": "repair",
              "DEPLOYMENT_CLAMAV_TARGET_IMAGE": graph["clamav"], "ADVISORY_PID": str(holder["clientPid"]),
              "ADVISORY_APPLICATION_NAME": holder["applicationName"], "ADVISORY_LOCK_KEY": str(ADVISORY_KEY),
              "DEPLOYMENT_QA_REHEARSAL_PLAN_FILE": plan, "DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256": plan_sha}
    for service, image in graph.items():
        values["DEPLOYMENT_" + service.upper() + "_IMAGE"] = image
        values["DEPLOYMENT_PREVIOUS_" + service.upper() + "_IMAGE"] = image
    return values


def verify_checkpoint_file(file, expected):
    require(file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size == 1358636732)
        require(hashlib.file_digest(handle, "sha256").hexdigest() == expected)
        pin = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        require(pin(before) == pin(os.fstat(fd)) == pin(file.lstat()))


def recovery_inputs(plan, plan_sha, original_env, evidence_sha):
    canonical = load_canonical_owner()
    host = canonical.host
    root = Path("/opt/sabalanerp")
    qa = Path("/srv/sabalanerp-qa")
    reports = qa / "reports"
    compose = root / "docker-compose.rehearsal.yml"
    proof = inspect_evidence(plan, plan_sha, original_env)
    require(host.digest(host.json_bytes(proof)) == evidence_sha)
    operation = proof["deploymentId"]
    folder = root / ".deploy-state" / ("predecessor-role-host-" + operation)
    session = json.loads(host.read_private(reports / "active-deployment-session.json")[0])
    configuration = json.loads(host.read_private(folder / "configuration-private.json")[0])
    env = Path(configuration["environment"])
    serving_record = json.loads(host.read_private(folder / "canonical-serving-environment.json")[0])
    foreground = json.loads(host.read_private(folder / "foreground-plan.json")[0])
    _, coordination = canonical.installed_role_backend(root, env, compose, session["controlImage"])
    _, checkpoint, binding = host.context(root, reports, coordination, "MUTATION_STARTED")
    require(serving_record["binding"] == foreground["binding"] == binding)
    require(serving_record["preflight"] == foreground["preflight"])
    native_runtime_closed(coordination)
    return canonical, root, qa, reports, compose, proof, session, folder, configuration, env, serving_record, foreground, coordination


def recover(plan, plan_sha, original_env, evidence_sha):
    (canonical, root, qa, reports, compose, proof, session, folder, configuration, env,
     serving_record, foreground, coordination) = recovery_inputs(plan, plan_sha, original_env, evidence_sha)
    host = canonical.host
    operation = proof["deploymentId"]
    attempt = folder / "interrupted-recovery-attempt.json"
    archive_clock = folder / "interrupted-recovery-original-rollback-deadline.json"
    require(not os.path.lexists(attempt) and not os.path.lexists(archive_clock))
    archive = operation + ".sabrec"
    print("QA_RECOVERY_CHECKPOINT_READBACK_STARTED", file=sys.stderr, flush=True)
    verify_checkpoint_file(Path("/var/lib/docker/volumes/sabalanerp_backend_recovery/_data/packages") / archive,
                           proof["checkpointSha256"])
    verify_checkpoint_file(qa / "remote" / operation.removeprefix("deploy-") / archive, proof["checkpointSha256"])
    require(inspect_evidence(plan, plan_sha, original_env) == proof)
    print("QA_RECOVERY_CHECKPOINT_READBACK_VERIFIED", file=sys.stderr, flush=True)
    native_runtime_closed(coordination)

    with recovery_advisory(operation, canonical_label=True) as holder:
        env_values = recovery_environment(session, serving_record["serving"], holder, plan, plan_sha)
        env_values["DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX"] = host.json_bytes(session["preservedClamav"]).strip().hex()
        os.environ.update(env_values)
        canonical.owner_context(root, env, reports, coordination)
        original_clock, old_end = canonical.read_deadline(reports, session, "rollback")
        require(time.monotonic_ns() >= old_end)
        require(not os.path.lexists(reports / "predecessor-role-cutover-open-intent.json"))
        require(canonical.held_owner_command(root, canonical.canonical_shell(env, compose, "public-maintenance")))
        host.write_private(archive_clock, original_clock)
        host.write_private(attempt, host.json_bytes({
            "format": "sabalan-qa-interrupted-role-recovery-attempt/v1",
            "evidence": proof, "evidenceSha256": evidence_sha, "observedHolder": holder,
            "ownerPid": os.getpid(), "originalRollbackDeadlineSha256": host.digest(original_clock),
        }))
        print("QA_RECOVERY_OWNER_RECORDED", file=sys.stderr, flush=True)
        start = time.monotonic_ns()
        end = start + 900 * canonical.NS
        host.write_private(canonical.clock_file(reports, session, "rollback"), host.json_bytes({
            "format": "sabalan-predecessor-role-deadline-v1", **canonical.clock_binding(session),
            "kind": "rollback", "clock": canonical.clock_identity(), "startedNs": str(start),
            "deadlineNs": str(end), "budgetSeconds": 900,
        }))
        canonical.assert_qa_rollback_legacy_resolved(root, env, reports, compose, configuration["previousSha256"])
        native_runtime_closed(coordination)
        require(time.monotonic_ns() < end)
        os.environ["DEPLOYMENT_PHASE"] = "ROLLBACK_STARTED"
        require(canonical.held_owner_command(root, canonical.canonical_shell(env, compose, "control", "transition")))
        print("QA_RECOVERY_CANONICAL_ROLLBACK_ENTERED", file=sys.stderr, flush=True)
        outcome = canonical.launch_owned_role_cutover(root, env, reports, compose, "ROLLBACK_STARTED", foreground["preflight"])
    return outcome


if __name__ == "__main__":
    try:
        if len(sys.argv) == 5 and sys.argv[1] == "--check-owner-lock":
            print(json.dumps(prove_owner(*sys.argv[2:])))
        elif len(sys.argv) == 6 and sys.argv[1] == "--check-recovery-inputs":
            inputs = recovery_inputs(*sys.argv[2:])
            print(json.dumps({**inputs[5], "nativeRuntimeClosed": True}))
        else:
            require(len(sys.argv) == 6 and sys.argv[1] == "--recover")
            print(json.dumps(recover(*sys.argv[2:])))
    except (AssertionError, EOFError, KeyError, OSError, RuntimeError, ValueError, subprocess.SubprocessError):
        print("QA_INTERRUPTED_ROLE_OWNER_UNPROVEN", file=sys.stderr)
        sys.exit(1)

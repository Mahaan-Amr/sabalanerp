"""Continue the single held 76a6ea7c QA rollback after its native owner exited."""
import importlib.util
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

directory = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("interrupted_role", directory / "qa-interrupted-role-owner.py")
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)
canonical = owner.load_canonical_owner()
host = canonical.host
require = owner.require

ROOT = Path("/opt/sabalanerp")
QA = Path("/srv/sabalanerp-qa")
REPORTS = QA / "reports"
COMPOSE = ROOT / "docker-compose.rehearsal.yml"
OPERATION = "deploy-20261119T203627Z-76a6ea7ceb72-configuration"
COMMIT = "76a6ea7ceb722427ecf84b279bee570462c104e7"
JOURNAL = "da081571985b2d6ef00455fc20f472e67cc6c48bc398d18b5871cb255568adc5"
RECEIPT = "c5d931793dc1753234095537a7377c10e69fab1e1a018e3ab34fcbab64d94b25"
CLOCK = "f3de1996aab5f1787fed59fce6e4677f631799396a46e01b072468fd7868889c"
CHECKPOINT = "b4731e84948ef25b4ef1394968305615f9eec8914718e754ebfc39e007610cf5"
PLAN = QA / "private/qualify-predecessor-76a6ea7c.PACvHbq7/qa-target-plan.json"
PLAN_SHA = "f29a0093777eaee17660c17f1106214f7cc3fa6f95ea80314615fa433b50dcdd"
ORIGINAL_ENV = PLAN.with_name("qa.env")
ROLE_ENV = QA / "private/predecessor-76a6-single-role-preflight.we0oOcy6/qa.env"
COORDINATION = Path("/var/lib/docker/volumes/sabalanerp_recovery_coordination/_data")
TRANSACTION = ROOT / ".deploy-state" / ("predecessor-role-host-" + OPERATION)
READBACK = QA / "private/qa-76a6-rollback-readback.KaZabXQb/readback.json"
PHASE = "ROLLBACK_STARTED"
ACTIONS = {
    "stage-predecessor-role-grants": "MUTATION_STARTED",
    "activate-predecessor-runtime-login": "MUTATION_STARTED",
    "recreate-backend": "MUTATION_STARTED",
    "restore-predecessor-role-grants": PHASE,
}
BINDING_KEYS = ("checkpointSha256", "checkpointMetadataSha256", "deploymentId", "releaseId")


def private_json(path):
    return json.loads(host.read_private(path)[0])


def verify_children(binding):
    results = sorted(TRANSACTION.glob("native-*-result.json"))
    require(len(results) == len(list(TRANSACTION.glob("native-*-intent.json"))) == len(ACTIONS))
    observed = set()
    for path in results:
        result = private_json(path)
        raw, _ = host.read_private(path.with_name(path.name.replace("-result.json", "-intent.json")))
        intent = json.loads(raw)
        action = result["action"]
        require(action not in observed and result["phase"] == ACTIONS[action])
        observed.add(action)
        require(host.digest(raw) == result["intentSha256"])
        for key in (*BINDING_KEYS, "action", "phase", "attemptId", "canOpenTraffic"):
            require(result[key] == intent[key])
        require(all(result[key] == binding[key] for key in BINDING_KEYS))
        require(result["canOpenTraffic"] is False and result["returnCode"] == 0 and result["outcome"] == "CLOSED")
        require(all(result[key] is True for key in ("childClosed", "stdoutClosed", "stderrClosed", "intentUnchanged")))
        require(not any(result[key] for key in ("heartbeatFailed", "deadlineExceeded", "credentialEchoed",
                    "inputFailed", "outputOverflow", "streamFailed", "interruptSignals")))


def verify_checkpoint_readback(pin):
    raw, _ = host.read_private(READBACK)
    require(host.digest(raw) == pin)
    files = {}
    archive = OPERATION + ".sabrec"
    for path in (Path("/var/lib/docker/volumes/sabalanerp_backend_recovery/_data/packages") / archive,
                 QA / "remote" / OPERATION.removeprefix("deploy-") / archive):
        current = path.lstat()
        require(path.resolve(strict=True) == path and stat.S_ISREG(current.st_mode) and current.st_size == 1358938492)
        files[str(path)] = [current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns]
    require(json.loads(raw) == {"format": "sabalan-qa-76a6-rollback-readback/v1", "deploymentId": OPERATION,
                                "journalSha256": JOURNAL, "checkpointSha256": CHECKPOINT, "files": files})


def verify_database(session):
    argv = (*owner.DB[:-1], owner.DB[-1].replace("-d postgres", "-d sabalanerp_qa_432"))
    sql = f"""
BEGIN READ ONLY;
SELECT json_build_object('id',id,'lease', "leaseToken", 'phase',phase,
  'active',"activeKey" IS NOT NULL,'complete',"completedAt" IS NOT NULL,
  'expired',"leaseExpiresAt"<clock_timestamp())
FROM deployment_operations WHERE id='{OPERATION}';
SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=741936425 AND objsubid=1 AND granted;
SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname IN ('sabalan_application_runtime','sabalan_allocation_controller');
SELECT count(*) FROM pg_stat_activity WHERE usename IN ('sabalan_application_runtime','sabalan_allocation_controller');
ROLLBACK;
"""
    rows = subprocess.check_output(argv, input=sql, text=True, timeout=15, stderr=subprocess.DEVNULL).splitlines()
    require(rows[2:5] == ["0", "0", "0"])
    result = json.loads(rows[1])
    require(result["id"] == OPERATION and result["lease"] == session["leaseToken"]
            and result["phase"] == PHASE and result["active"] is True and result["complete"] is False)
    return result["expired"] is True


def inspect(pin):
    host.verify_lock(ROOT)
    target = subprocess.check_output(["node", str(directory / "qa-rehearsal-target.mjs"),
                                      str(PLAN), PLAN_SHA, str(ROOT), str(ORIGINAL_ENV)], text=True,
                                     timeout=30, stderr=subprocess.DEVNULL).strip()
    require(target == COMPOSE.name)
    session, _, binding = host.context(ROOT, REPORTS, COORDINATION, PHASE)
    require(binding["deploymentId"] == OPERATION and binding["targetCommit"] == COMMIT
            and binding["checkpointSha256"] == CHECKPOINT)
    for d in (ROOT / ".deploy-state", REPORTS):
        require((d / "predecessor-role-cutover-active.json").is_file())
    require(not os.path.lexists(REPORTS / "predecessor-role-cutover-open-intent.json"))
    require(not any(TRANSACTION.glob("*restored-intent.json")) and not any(TRANSACTION.glob("*restored-proof.json")))
    attempt = TRANSACTION / "76a6-rollback-owner-attempt.json"
    clock_archive = TRANSACTION / "76a6-rollback-original-deadline.json"
    require(not os.path.lexists(attempt) and not os.path.lexists(clock_archive))
    require(host.digest(host.read_private(REPORTS / "active-deployment.jsonl")[0]) == JOURNAL)
    old_clock, deadline = canonical.read_deadline(REPORTS, session, "rollback")
    require(host.digest(old_clock) == CLOCK)
    verify_children(binding)

    private = TRANSACTION / "configuration-private.json"
    config, previous = host.load_snapshot(private, ROLE_ENV, binding)
    require(host.read_private(ROLE_ENV)[0] == previous == host.read_private(ORIGINAL_ENV)[0])
    raw, _ = host.read_private(TRANSACTION / "receipt.json")
    require(host.digest(raw) == RECEIPT and json.loads(raw) == {
        "format": "sabalan-predecessor-role-host-config-v1", **binding,
        "stageReceiptSha256": config["stageReceiptSha256"], "state": "RESTORED",
    })
    observed = private_json(TRANSACTION / "canonical-serving-environment.json")
    plan = private_json(TRANSACTION / "foreground-plan.json")
    preimage = private_json(TRANSACTION / "backend-runtime-preimage.json")
    require(observed["binding"] == plan["binding"] == preimage["binding"] == binding
            and observed["preflight"] == plan["preflight"]
            and {key: row["id"] for key, row in preimage["containers"].items()} == plan["preflight"]["containers"])
    graph = binding["rollbackReleaseSet"]
    rows = host.container_state(canonical.read_owner_json(ROOT, (*canonical.DOCKER, "inspect",
                                *(f"sabalanerp-{name}-1" for name in sorted(graph)))), graph)
    host.verify_runtime_graph(rows, preimage["containers"], environment=ROLE_ENV)
    for name, row in rows.items():
        require(row["State"]["Running"] is (name in {"nginx", "postgres", "clamav"}))
    backend = rows["backend"]
    require(backend["State"]["ExitCode"] == 0 and backend["Id"] != preimage["containers"]["backend"]["id"]
            and host.digest(host.backend_runtime_url(backend).encode()) == config["targetRuntimeSha256"])
    for name in ("erp.qa.test", "inquiry.qa.test"):
        result = subprocess.check_output(["curl", "--silent", "--show-error", "--max-time", "8", "--noproxy", "*",
                                          "--cacert", str(QA / "tls-stage/ca.crt"), "-o", "/dev/null",
                                          "-w", "%{http_code}", "https://" + name + "/"], text=True, timeout=10)
        require(result == "503")

    expired = verify_database(session)
    owner.native_runtime_closed(COORDINATION)
    if pin is not None:
        verify_checkpoint_readback(pin)
    return expired and time.monotonic_ns() >= deadline, session, config, observed, plan, old_clock, attempt, clock_archive


def recover(pin):
    ready, session, config, observed, plan, old_clock, attempt, clock_archive = inspect(pin)
    require(ready)
    with owner.recovery_advisory(OPERATION, canonical_label=True) as holder:
        os.environ.update(owner.recovery_environment(session, observed["serving"], holder, str(PLAN), PLAN_SHA))
        os.environ["DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX"] = host.json_bytes(session["preservedClamav"]).strip().hex()
        canonical.owner_context(ROOT, ROLE_ENV, REPORTS, COORDINATION)
        require(canonical.held_owner_command(ROOT, canonical.canonical_shell(ROLE_ENV, COMPOSE, "public-maintenance")))
        host.write_private(clock_archive, old_clock)
        host.write_private(attempt, host.json_bytes({
            "format": "sabalan-qa-76a6-rollback-owner-attempt/v1", "deploymentId": OPERATION,
            "oldClockSha256": CLOCK, "journalSha256": JOURNAL, "checkpointSha256": CHECKPOINT,
            "readbackSha256": pin, "observedHolder": holder, "ownerPid": os.getpid(),
        }))
        start = time.monotonic_ns()
        end = start + canonical.MUTATION_SECONDS * canonical.NS
        host.write_private(canonical.clock_file(REPORTS, session, "rollback"), host.json_bytes({
            "format": "sabalan-predecessor-role-deadline-v1", **canonical.clock_binding(session),
            "kind": "rollback", "clock": canonical.clock_identity(), "startedNs": str(start),
            "deadlineNs": str(end), "budgetSeconds": canonical.MUTATION_SECONDS,
        }))
        print("QA_76_ROLLBACK_OWNER_RECORDED", file=sys.stderr, flush=True)
        canonical.assert_qa_rollback_legacy_resolved(ROOT, ROLE_ENV, REPORTS, COMPOSE, config["previousSha256"])
        owner.native_runtime_closed(COORDINATION)
        require(time.monotonic_ns() < end)
        print("QA_76_CANONICAL_ROLLBACK_RESUMED", file=sys.stderr, flush=True)
        return canonical.launch_owned_role_cutover(ROOT, ROLE_ENV, REPORTS, COMPOSE, PHASE, plan["preflight"])


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--check"]:
            print(json.dumps({"ready": inspect(None)[0], "phase": PHASE, "operation": OPERATION}))
        elif len(sys.argv) == 3 and sys.argv[1] == "--recover" and host.matches(r"[a-f0-9]{64}", sys.argv[2]):
            print(json.dumps(recover(sys.argv[2])))
        else:
            raise ValueError()
    except (AssertionError, EOFError, KeyError, OSError, RuntimeError, ValueError, subprocess.SubprocessError):
        print("QA_76_ROLLBACK_UNPROVEN", file=sys.stderr)
        sys.exit(1)

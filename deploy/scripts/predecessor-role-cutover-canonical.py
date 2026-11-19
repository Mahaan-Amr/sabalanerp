"""Concrete native command factories for the protected role configuration owner.

This adapter is import-only. It assumes the canonical runner already owns its
host lock, PostgreSQL advisory session, maintenance marker and deployment lease.
"""

import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit


DIRECTORY = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("predecessor_role_cutover_native", DIRECTORY / "predecessor-role-cutover-native.py")
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)
host = native.configuration
DOCKER = ("docker", "--host", "unix:///var/run/docker.sock")
COMPOSE = ("compose", "--project-name", "sabalanerp")
BACKEND_RECREATE = ("up", "-d", "--no-deps", "--no-build", "--force-recreate", "--pull", "never",
                    "--wait", "--wait-timeout", "180", "backend")
SHELL = """set -eu
ENV_FILE=$1
COMPOSE_FILE=$2
. "$3"
shift 3
SYSTEM_RECOVERY_BACKUP=0
PROTECTED_BACKEND_NO_PULL=1
docker() { command docker --host unix:///var/run/docker.sock "$@"; }
curl() { command curl --max-time 10 "$@"; }
compose() { docker compose --project-name sabalanerp --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
env_value() { protected_env_value "$@"; }
case "$1" in
  control) shift; protected_backend_run node dist/scripts/deployment-control.js "$@";;
  gates) [ "$#" -eq 2 ]; DEPLOYMENT_GATE_MODE="$2" protected_backend_run node dist/scripts/deployment-gates.js;;
  renewal) protected_advisory_owned && protected_backend_run node dist/scripts/deployment-control.js heartbeat;;
  public-maintenance) protected_public_maintenance;;
  *) exit 64;;
esac
"""


CLOCK_PHASES = {"checkpoint": "SERVICES_DRAINED", "mutation": "REMOTE_CHECKPOINT_VERIFIED", "rollback": "MUTATION_STARTED"}
MUTATION_SECONDS = 900
NS = 1_000_000_000


def clock_identity():
    return {"bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "timeNamespace": os.readlink("/proc/self/ns/time")}


def clock_binding(session):
    return {"deploymentId": session["deploymentId"], "releaseId": session["releaseId"],
            "targetCommit": session["targetCommit"], "leaseTokenSha256": host.digest(session["leaseToken"].encode())}


def clock_session(root, report_dir):
    host.verify_lock(root)
    session = json.loads(host.read_private(report_dir / "active-deployment-session.json")[0])
    host.require(session["purpose"] == "predecessor-role-cutover" and not session["bootstrap"]
                 and session["deploymentId"] == os.environ.get("DEPLOYMENT_ID")
                 and session["leaseToken"] == os.environ.get("DEPLOYMENT_LEASE_TOKEN"))
    return session


def clock_file(report_dir, session, kind):
    operation = session["deploymentId"]
    host.require(host.matches(r"[A-Za-z0-9_-]{1,160}", operation) and kind in CLOCK_PHASES)
    return report_dir / ("predecessor-role-" + operation + "-" + kind + "-deadline.json")


def read_deadline(report_dir, session, kind):
    raw = host.read_private(clock_file(report_dir, session, kind))[0]
    record = json.loads(raw)
    start, end, budget = record["startedNs"], record["deadlineNs"], record["budgetSeconds"]
    host.require(record["format"] == "sabalan-predecessor-role-deadline-v1" and record["kind"] == kind
                 and all(record[key] == value for key, value in clock_binding(session).items())
                 and record["clock"] == clock_identity() and type(budget) is int
                 and (600 <= budget <= 14400 if kind == "checkpoint" else budget == MUTATION_SECONDS)
                 and host.matches(r"[1-9][0-9]{0,19}", start) and host.matches(r"[1-9][0-9]{0,19}", end)
                 and int(start) <= time.monotonic_ns() and int(end) - int(start) == budget * NS)
    return raw, int(end)


def start_deadline(root, report_dir, kind, seconds):
    session = clock_session(root, report_dir)
    host.require(session["phase"] == CLOCK_PHASES.get(kind)
                 and (600 <= seconds <= 14400 if kind == "checkpoint" else seconds == MUTATION_SECONDS))
    file = clock_file(report_dir, session, kind)
    host.require(not os.path.lexists(file))
    if kind == "mutation":
        prior, end = read_deadline(report_dir, session, "checkpoint")
        result = json.loads(host.read_private(file.with_name(file.name.replace("mutation-deadline", "checkpoint-result")))[0])
        host.require(result["format"] == "sabalan-predecessor-role-checkpoint-timing-v1"
                     and result["deadlineSha256"] == host.digest(prior) and result["exitStatus"] == 0
                     and result["withinDeadline"] is True and 0 < int(result["closedNs"]) < end)
    elif kind == "rollback":
        read_deadline(report_dir, session, "mutation")
        host.require(not os.path.lexists(report_dir / "predecessor-role-cutover-open-intent.json"))
    start = time.monotonic_ns()
    host.write_private(file, host.json_bytes({
        "format": "sabalan-predecessor-role-deadline-v1", **clock_binding(session), "kind": kind,
        "clock": clock_identity(), "startedNs": str(start), "deadlineNs": str(start + seconds * NS),
        "budgetSeconds": seconds,
    }))


def close_checkpoint_deadline(root, report_dir, status):
    session = clock_session(root, report_dir)
    host.require(session["phase"] == "SERVICES_DRAINED" and 0 <= status <= 255)
    raw, end = read_deadline(report_dir, session, "checkpoint")
    file = clock_file(report_dir, session, "checkpoint")
    result = file.with_name(file.name.replace("checkpoint-deadline", "checkpoint-result"))
    host.require(not os.path.lexists(result))
    closed = time.monotonic_ns()
    host.write_private(result, host.json_bytes({
        "format": "sabalan-predecessor-role-checkpoint-timing-v1", "deadlineSha256": host.digest(raw),
        "exitStatus": status, "closedNs": str(closed), "withinDeadline": closed < end,
    }))
    host.require(status == 0 and closed < end)


def mutation_deadline(report_dir, session):
    phase = session["phase"]
    host.require(phase in ("MUTATION_STARTED", "ROLLBACK_STARTED"))
    _, end = read_deadline(report_dir, session, "rollback" if phase == "ROLLBACK_STARTED" else "mutation")
    host.require(time.monotonic_ns() < end)
    return end

def owner_context(root, env, report_dir, coordination_dir):
    host.verify_lock(root)
    phase = json.loads(host.read_private(report_dir / "active-deployment-session.json")[0])["phase"]
    host.require(phase in ("MUTATION_STARTED", "ROLLBACK_STARTED"))
    session, checkpoint, binding = host.context(root, report_dir, coordination_dir, phase)
    required = {
        "COMPOSE_PROJECT_NAME": "sabalanerp", "DEPLOYMENT_MODE": "configuration",
        "DEPLOYMENT_ID": session["deploymentId"], "DEPLOYMENT_RELEASE_ID": session["releaseId"],
        "DEPLOYMENT_OWNER": session["owner"], "DEPLOYMENT_LEASE_TOKEN": session["leaseToken"],
        "DEPLOYMENT_TARGET_COMMIT": session["targetCommit"], "DEPLOYMENT_PHASE": phase,
        "DEPLOYMENT_TARGET_BACKEND_IMAGE": session["controlImage"],
        "DEPLOYMENT_CLAMAV_REPAIR": "false", "DEPLOYMENT_CLAMAV_OPERATION": "repair",
        "ADVISORY_APPLICATION_NAME": "sabalan-lock-" + session["deploymentId"], "ADVISORY_LOCK_KEY": "741936425",
    }
    for service, image in binding["rollbackReleaseSet"].items():
        required["DEPLOYMENT_" + service.upper() + "_IMAGE"] = image
        required["DEPLOYMENT_PREVIOUS_" + service.upper() + "_IMAGE"] = image
    host.require(all(os.environ.get(key) == value for key, value in required.items())
                 and host.matches(r"[1-9][0-9]*", os.environ.get("ADVISORY_PID"))
                 and not os.environ.get("DOCKER_CONTEXT")
                 and not any(os.environ.get(key) for key in ("BACKEND_DATABASE_USER", "BACKEND_DATABASE_PASSWORD",
                                                            "DEPLOYMENT_DATABASE_USER", "DEPLOYMENT_DATABASE_PASSWORD",
                                                            "COMPOSE_FILE", "COMPOSE_PROFILES", "COMPOSE_ENV_FILES")))
    scanner = bytes.fromhex(os.environ["DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX"])
    host.require(json.loads(scanner) == session["preservedClamav"])
    host.read_private(env)
    return session, checkpoint, binding


def canonical_shell(env, compose, action, *args):
    return ("/bin/sh", "-c", SHELL, "protected-role-owner", str(env), str(compose),
            str(DIRECTORY / "protected-owner-transport.sh"), action, *args)


def canonical_compose(env, compose, *args):
    return (*DOCKER, *COMPOSE, "--env-file", str(env), "-f", str(compose), *args)


def held_owner_command(root, command):
    return subprocess.run(command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, pass_fds=(9,), check=False).returncode == 0


def read_owner_json(root, command):
    completed = subprocess.run(command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, pass_fds=(9,), check=True, timeout=30)
    host.require(len(completed.stdout) <= 16 * 1024 * 1024)
    return json.loads(completed.stdout)


def refresh_original_nginx(root, report_dir, coordination_dir, phase, proof, planned_nginx_id, *, inspect,
                           renewal, maintenance, restart, wait_for_healthy, environment=None):
    """Refresh only the exact original nginx. This proof cannot reopen traffic."""
    session, checkpoint, binding = host.context(root, report_dir, coordination_dir, phase)
    private, _ = host.transaction_paths(root, binding["deploymentId"])
    state = "RESTORED" if phase == "ROLLBACK_STARTED" else "APPLIED"
    durable = json.loads(host.read_private(private.with_name("backend-runtime-" + state.lower() + "-proof.json"))[0])
    host.require(durable == proof and proof["state"] == state and proof["canOpenTraffic"] is False)
    original = json.loads(host.read_private(private.with_name("backend-runtime-preimage.json"))[0])
    host.require(original["binding"] == binding and original["containers"]["nginx"]["id"] == planned_nginx_id)

    def observe():
        rows = host.container_state(inspect(), binding["rollbackReleaseSet"])
        host.verify_runtime_graph(rows, original["containers"], environment=environment)
        backend = rows["backend"]
        nginx = rows["nginx"]
        addresses = [entry["IPAddress"] for entry in backend["NetworkSettings"]["Networks"].values()]
        host.require(backend["Id"] == proof["backendId"] and addresses == [proof["backendAddress"]]
                     and backend["State"]["Running"] is True and backend["State"]["Health"]["Status"] == "healthy"
                     and nginx["Id"] == planned_nginx_id and nginx["State"]["Running"] is True)
        return rows, nginx

    host.require(renewal(session, checkpoint) is True and maintenance() is True)
    rows, nginx = observe()
    before = host.backend_observation(rows)
    intent_path = private.with_name("nginx-" + state.lower() + "-intent.json")
    expected_intent = {"binding": binding, "nginxId": planned_nginx_id, "backendId": proof["backendId"],
                       "roleProofSha256": host.digest(host.json_bytes(proof))}
    try:
        intent = json.loads(host.read_private(intent_path)[0])
        birth = intent.pop("originalStartedAt")
        host.require(intent == expected_intent and nginx["State"]["StartedAt"] != birth)
    except FileNotFoundError:
        birth = nginx["State"]["StartedAt"]
        host.write_private(intent_path, host.json_bytes({**expected_intent, "originalStartedAt": birth}))
        host.require(restart(planned_nginx_id) is True)

    wait_for_healthy()
    rows, nginx = observe()
    host.require(nginx["State"]["StartedAt"] != birth and nginx["State"]["Health"]["Status"] == "healthy"
                 and host.backend_observation(rows) == before)
    host.require(renewal(session, checkpoint) is True and maintenance() is True
                 and host.context(root, report_dir, coordination_dir, phase) == (session, checkpoint, binding))
    receipt = {"format": "sabalan-predecessor-role-nginx-refresh-v1", "deploymentId": binding["deploymentId"],
               "checkpointSha256": binding["checkpointSha256"], "backendId": proof["backendId"],
               "nginxId": planned_nginx_id, "originalStartedAt": birth, "refreshedStartedAt": nginx["State"]["StartedAt"],
               "roleProofSha256": expected_intent["roleProofSha256"], "canOpenTraffic": False}
    host.write_private(private.with_name("nginx-" + state.lower() + "-proof.json"), host.json_bytes(receipt))
    return receipt


def acknowledge_role_gates(root, report_dir, coordination_dir, phase, proof, nginx, *,
                           gates, verify_current, renewal, maintenance):
    """Persist positive completion of the held gates, with public traffic still fenced."""
    authority = host.context(root, report_dir, coordination_dir, phase)
    session, checkpoint, binding = authority
    state, mode, gate_count = ("RESTORED", "PREDECESSOR_ROLE_ROLLBACK", 16) if phase == "ROLLBACK_STARTED" else (
        "APPLIED", "PREDECESSOR_ROLE_APPLIED", 19)
    private, _ = host.transaction_paths(root, binding["deploymentId"])
    role_raw = host.read_private(private.with_name("backend-runtime-" + state.lower() + "-proof.json"))[0]
    nginx_raw = host.read_private(private.with_name("nginx-" + state.lower() + "-proof.json"))[0]
    host.require(phase in ("MUTATION_STARTED", "ROLLBACK_STARTED")
                 and role_raw == host.json_bytes(proof) and nginx_raw == host.json_bytes(nginx)
                 and proof["state"] == state and proof["backendId"] == nginx["backendId"]
                 and proof["deploymentId"] == nginx["deploymentId"] == binding["deploymentId"]
                 and proof["checkpointSha256"] == nginx["checkpointSha256"] == binding["checkpointSha256"]
                 and nginx["roleProofSha256"] == host.digest(role_raw)
                 and proof["canOpenTraffic"] is False and nginx["canOpenTraffic"] is False)

    def assert_current():
        host.require(host.context(root, report_dir, coordination_dir, phase) == authority
                     and renewal(session, checkpoint) is True and maintenance() is True
                     and verify_current() is True)

    assert_current()
    raw, closure = gates(mode)
    host.require(closure["outcome"] == "CLOSED" and closure["canOpenTraffic"] is False
                 and closure["action"] == "deployment-gates" and closure["phase"] == phase
                 and closure["deploymentId"] == binding["deploymentId"] and closure["checkpointSha256"] == binding["checkpointSha256"]
                 and closure["childClosed"] is True and closure["stdoutClosed"] is True and closure["stderrClosed"] is True)
    attempt = closure["attemptId"]
    host.require(host.matches(r"[a-f0-9]{32}", attempt))
    closure_path = private.with_name("native-" + attempt + "-result.json")
    closure_raw = host.read_private(closure_path)[0]
    host.require(closure_raw == host.json_bytes(closure))
    result = json.loads(raw)
    report_path = Path(result["reportPath"])
    report_name = report_path.name
    suffix = r"\.rollback" if state == "RESTORED" else ""
    pattern = binding["deploymentId"] + suffix + r"(?:\.[0-9]+)?\.json"
    host.require(set(result) == {"ok", "reportPath", "gates"} and result["ok"] is True
                 and report_path.parent == Path("/app/deployment-reports") and host.matches(pattern, report_name))
    report_raw = host.read_private(report_dir / report_name)[0]
    report = json.loads(report_raw)
    gates_rows = result["gates"]
    checkpoint_gates = [gate for gate in gates_rows if gate["name"] == "checkpoint-manifest"]
    host.require(report["format"] == "sabalan-deployment-report" and report["version"] == 1 and report["mode"] == mode
                 and report["deploymentId"] == binding["deploymentId"] and report["releaseId"] == binding["releaseId"]
                 and report["targetCommit"] == binding["targetCommit"] and report["gates"] == gates_rows
                 and len(gates_rows) == gate_count and len({gate["name"] for gate in gates_rows}) == gate_count
                 and all(gate["passed"] is True for gate in gates_rows) and len(checkpoint_gates) == 1)
    verified = checkpoint_gates[0]["details"]
    host.require(verified["checksum"] == binding["checkpointSha256"] and verified["releaseId"] == binding["releaseId"]
                 and verified["remoteReadBack"] is True)
    assert_current()
    host.require(host.read_private(closure_path)[0] == closure_raw
                 and host.read_private(report_dir / report_name)[0] == report_raw
                 and host.read_private(private.with_name("backend-runtime-" + state.lower() + "-proof.json"))[0] == role_raw
                 and host.read_private(private.with_name("nginx-" + state.lower() + "-proof.json"))[0] == nginx_raw)
    acknowledgement = {"format": "sabalan-predecessor-role-gate-acknowledgement-v1", **binding,
                       "state": state, "gateMode": mode, "gateCount": gate_count, "backendId": proof["backendId"],
                       "nginxId": nginx["nginxId"], "roleProofSha256": host.digest(role_raw),
                       "nginxProofSha256": host.digest(nginx_raw), "gateReport": report_name,
                       "gateReportSha256": host.digest(report_raw),
                       "nativeClosureSha256": host.digest(closure_raw), "canOpenTraffic": False}
    host_hold = root / ".deploy-state/predecessor-role-cutover-active.json"
    if state == "RESTORED" and not os.path.lexists(host_hold):
        # A staged-only failure may never have attempted host login activation.
        # An exact restored runtime and passing rollback gates can fence it now.
        host.write_private(host_hold, host.json_bytes({
            "format": "sabalan-predecessor-role-cutover-restored-host-hold/v1",
            "deploymentId": binding["deploymentId"], "releaseId": binding["releaseId"],
            "checkpointMetadataSha256": binding["checkpointMetadataSha256"],
            "gateReportSha256": acknowledgement["gateReportSha256"],
        }))
    host.write_private(private.with_name("role-gates-" + state.lower() + "-acknowledgement.json"),
                       host.json_bytes(acknowledgement))
    return acknowledgement


def start_original_siblings(root, report_dir, coordination_dir, phase, proof, planned, *, inspect, renewal, maintenance,
                            deadline_ns, environment=None):
    session, checkpoint, binding = host.context(root, report_dir, coordination_dir, phase)
    private, _ = host.transaction_paths(root, binding["deploymentId"])
    original = json.loads(host.read_private(private.with_name("backend-runtime-preimage.json"))[0])
    host.require(time.monotonic_ns() < deadline_ns and original["binding"] == binding
                 and maintenance() is True and renewal(session, checkpoint) is True)

    def inspect_original():
        rows = host.container_state(inspect(), binding["rollbackReleaseSet"])
        host.verify_runtime_graph(rows, original["containers"], environment=environment)
        host.require(rows["backend"]["Id"] == proof["backendId"])
        return rows

    names = ("frontend", "inquiry")
    rows = inspect_original()
    host.require(all(rows[name]["Id"] == planned[name] for name in names))
    stopped = [planned[name] for name in names if rows[name]["State"]["Running"] is not True]
    if stopped:
        state = "restored" if phase == "ROLLBACK_STARTED" else "applied"
        intent = private.with_name("start-original-siblings-" + state + "-intent.json")
        host.require(not os.path.lexists(intent))
        host.write_private(intent, host.json_bytes({**binding, "containerIds": stopped, "backendId": proof["backendId"]}))
        native.run_native_child(root, report_dir, coordination_dir, phase, "start-original-siblings",
                                (*DOCKER, "start", *stopped), renewal=renewal, deadline_ns=deadline_ns)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline and time.monotonic_ns() < deadline_ns:
        host.require(renewal(session, checkpoint) is True and maintenance() is True)
        rows = inspect_original()
        if all(rows[name]["State"]["Running"] is True and rows[name]["State"]["Health"]["Status"] == "healthy" for name in names):
            return
        time.sleep(1)
    host.require(False)


def run_canonical_foreground(root, env, report_dir, coordination_dir, preflight, credential_fd, *, compose=None):
    """Run the already-owned configuration continuation through native transports."""
    session, checkpoint, binding = owner_context(root, env, report_dir, coordination_dir)
    phase = session["phase"]
    deadline_ns = mutation_deadline(report_dir, session)
    compose = compose or root / "docker-compose.prod.yml"
    host.require(compose.resolve() == compose and compose.is_file())
    graph = binding["rollbackReleaseSet"]
    private, _ = host.transaction_paths(root, binding["deploymentId"])

    def inspect():
        ids = subprocess.check_output(canonical_compose(env, compose, "ps", "--all", "--quiet", *sorted(graph)),
                                      cwd=root, stderr=subprocess.DEVNULL, timeout=30).decode("ascii").split()
        host.require(len(ids) == len(graph) and all(host.matches(r"[a-f0-9]{64}", value) for value in ids))
        rows = read_owner_json(root, (*DOCKER, "inspect", *ids))
        backend = host.container_state(rows, graph)["backend"]
        coordination = [mount for mount in backend["Mounts"] if mount["Destination"] == "/app/recovery-coordination"]
        host.require(len(coordination) == 1 and coordination[0]["Source"] == str(coordination_dir)
                     and coordination[0]["RW"] is True)
        return rows

    transport_path = private.with_name("canonical-serving-environment.json")
    try:
        transport = json.loads(host.read_private(transport_path)[0])
    except FileNotFoundError:
        row = host.container_state(inspect(), graph)["backend"]
        host.require(row["Id"] == preflight["containers"]["backend"])
        expected_names = {
            "APP_COMMIT", "DEPLOYMENT_RELEASE_ID", "PERFORMANCE_RELEASE_COMMIT", "PERFORMANCE_RELEASE_SOURCE_HASH",
            "PERFORMANCE_RELEASE_SCHEMA_HASH", "PERFORMANCE_RELEASE_POLICY_HASH", "PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH",
            "PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH", "PERFORMANCE_RELEASE_BACKEND_IMAGE",
            "PERFORMANCE_RELEASE_FRONTEND_IMAGE", "PERFORMANCE_RELEASE_INQUIRY_IMAGE",
        }
        serving = {}
        for entry in row["Config"]["Env"]:
            name, value = entry.split("=", 1)
            if name in expected_names:
                host.require(name not in serving and host.matches(r"[A-Za-z0-9_:-]{0,160}", value))
                serving[name] = value
        host.require(set(serving) == expected_names and serving["APP_COMMIT"] == preflight["sourceCommit"]
                     and serving["PERFORMANCE_RELEASE_COMMIT"] == preflight["sourceCommit"]
                     and serving["PERFORMANCE_RELEASE_SOURCE_HASH"] == preflight["sourceHash"])
        transport = {"binding": binding, "preflight": preflight, "serving": serving}
        host.write_private(transport_path, host.json_bytes(transport))
    host.require(transport["binding"] == binding and transport["preflight"] == preflight)
    serving_overrides = tuple(name + "=" + value for name, value in sorted(transport["serving"].items()))

    def serving_compose(environment, *args):
        return ("env", *serving_overrides, *canonical_compose(environment, compose, *args))

    def observe(raw):
        fd, filename = tempfile.mkstemp(prefix=".render-environment-", dir=private.parent)
        try:
            with os.fdopen(fd, "wb") as target:
                target.write(raw)
            model = read_owner_json(root, serving_compose(Path(filename), "--profile", "deployment", "config", "--format", "json"))
            reports = [mount for mount in model["services"]["deployment"]["volumes"]
                       if mount["target"] == "/app/deployment-reports"]
            host.require(len(reports) == 1 and reports[0]["type"] == "bind" and reports[0]["source"] == str(report_dir)
                         and not reports[0].get("read_only", False))
            rows = host.container_state(inspect(), graph)
            return model, {key: row["Image"] for key, row in rows.items()}, host.backend_runtime_url(rows["backend"])
        finally:
            Path(filename).unlink(missing_ok=True)

    def renew(actual, point):
        return (actual == session and point == checkpoint and owner_context(root, env, report_dir, coordination_dir) == (session, checkpoint, binding)
                and held_owner_command(root, canonical_shell(env, compose, "renewal")))

    def maintenance():
        return held_owner_command(root, canonical_shell(env, compose, "public-maintenance"))

    def compose_argv(command):
        host.require(tuple(command) == BACKEND_RECREATE)
        host.require(held_owner_command(root, ("node", str(DIRECTORY / "preserved-clamav.mjs"), "compose", *command)))
        return serving_compose(env, *command)

    host.require(maintenance())
    proof = native.run_native_foreground(
        root, env, report_dir, coordination_dir, preflight, credential_fd,
        renewal=renew, deadline_ns=deadline_ns,
        verify_boundary=lambda actual, point: time.monotonic_ns() < deadline_ns and renew(actual, point) and maintenance(),
        observe=observe, inspect=inspect, compose_argv=compose_argv,
        control_argv=lambda command, args: canonical_shell(env, compose, "control", command, *args),
    )

    start_original_siblings(root, report_dir, coordination_dir, phase, proof, preflight["containers"],
                            inspect=inspect, renewal=renew, maintenance=maintenance, deadline_ns=deadline_ns,
                            environment=env)

    def restart(identifier):
        native.run_native_child(root, report_dir, coordination_dir, phase, "refresh-nginx",
                                (*DOCKER, "restart", "--time", "30", identifier), renewal=renew, deadline_ns=deadline_ns)
        return True

    def wait_for_health():
        until = time.monotonic() + 60
        while time.monotonic() < until and time.monotonic_ns() < deadline_ns:
            host.require(renew(session, checkpoint))
            rows = host.container_state(inspect(), graph)
            if rows["nginx"]["State"]["Health"]["Status"] == "healthy":
                return
            time.sleep(1)
        host.require(False)

    nginx = refresh_original_nginx(root, report_dir, coordination_dir, phase, proof, preflight["containers"]["nginx"],
                                   inspect=inspect, renewal=renew, maintenance=maintenance, restart=restart,
                                   wait_for_healthy=wait_for_health, environment=env)
    original = json.loads(host.read_private(private.with_name("backend-runtime-preimage.json"))[0])
    host.require(original["binding"] == binding)
    final_rows = host.container_state(inspect(), graph)
    host.verify_runtime_graph(final_rows, original["containers"], environment=env)
    host.require(final_rows["backend"]["Id"] == proof["backendId"]
                 and [row["IPAddress"] for row in final_rows["backend"]["NetworkSettings"]["Networks"].values()] == [proof["backendAddress"]])
    final_backend = host.backend_observation(final_rows)

    def prove_current_graph():
        rows = host.container_state(inspect(), graph)
        return (host.backend_observation(rows) == final_backend
                and rows["nginx"]["Id"] == nginx["nginxId"]
                and rows["nginx"]["State"]["StartedAt"] == nginx["refreshedStartedAt"]
                and rows["nginx"]["State"]["Health"]["Status"] == "healthy")

    def gates(mode):
        return native.run_native_child(root, report_dir, coordination_dir, phase, "deployment-gates",
                                       canonical_shell(env, compose, "gates", mode), renewal=renew, budget_seconds=600,
                                       deadline_ns=deadline_ns)

    gate_proof = acknowledge_role_gates(root, report_dir, coordination_dir, phase, proof, nginx,
                                        gates=gates, verify_current=prove_current_graph, renewal=renew,
                                        maintenance=maintenance)
    return {"runtimeProof": proof, "nginxProof": nginx, "gateAcknowledgement": gate_proof, "canOpenTraffic": False}


def publish_canonical_terminal(root, env, report_dir, coordination_dir, gate_ack, *, compose=None):
    """Publish and finish an already-owned same-image cutover under inherited FD9."""
    terminal_spec = importlib.util.spec_from_file_location("predecessor_role_terminal", DIRECTORY / "predecessor-role-cutover-terminal.py")
    terminal = importlib.util.module_from_spec(terminal_spec)
    terminal_spec.loader.exec_module(terminal)
    authority = owner_context(root, env, report_dir, coordination_dir)
    session, checkpoint, binding = authority
    phase = session["phase"]
    deadline_ns = mutation_deadline(report_dir, session)
    compose = compose or root / "docker-compose.prod.yml"
    private, _ = host.transaction_paths(root, session["deploymentId"])
    env_raw = host.read_private(env)[0]
    point_raw = host.read_private(coordination_dir / "deployment-checkpoint.json")[0]
    runtime_file = private.with_name("backend-runtime-" + gate_ack["state"].lower() + "-proof.json")
    nginx_file = private.with_name("nginx-" + gate_ack["state"].lower() + "-proof.json")
    runtime_raw = host.read_private(runtime_file)[0]
    nginx_raw = host.read_private(nginx_file)[0]
    host.require(host.digest(runtime_raw) == gate_ack["roleProofSha256"] and host.digest(nginx_raw) == gate_ack["nginxProofSha256"])
    runtime = json.loads(runtime_raw)
    nginx = json.loads(nginx_raw)
    original = json.loads(host.read_private(private.with_name("backend-runtime-preimage.json"))[0])
    host.require(original["binding"] == binding)
    gate_digest = host.digest(host.json_bytes(gate_ack))
    expected_terminal = "COMPLETED" if phase == "MUTATION_STARTED" else "ROLLED_BACK"
    terminal_result = {"deploymentId": binding["deploymentId"], "releaseId": binding["releaseId"],
                       "targetCommit": binding["targetCommit"], "checkpointSha256": binding["checkpointSha256"],
                       "gateAcknowledgementSha256": gate_digest, "phase": expected_terminal, "activeLeases": 0}

    environment = env_raw.decode("utf8").splitlines()
    origins = []
    for key in ("DOMAIN", "INQUIRY_DOMAIN"):
        values = [line.removeprefix(key + "=") for line in environment if line.startswith(key + "=")]
        host.require(len(values) == 1 and host.matches(r"[A-Za-z0-9.-]{1,253}", values[0]))
        origins.append(values[0])

    def marker_sealed():
        return os.path.lexists(coordination_dir / terminal.MAINTENANCE)

    def read_terminal():
        response = read_owner_json(root, canonical_shell(env, compose, "control", "read-predecessor-role-terminal"))
        host.require(response == {"ok": True, "result": terminal_result})
        return response["result"]

    def probe():
        host.verify_lock(root)
        host.require(host.read_private(env)[0] == env_raw
                     and host.read_private(coordination_dir / "deployment-checkpoint.json")[0] == point_raw)
        if marker_sealed():
            host.require(host.context(root, report_dir, coordination_dir, phase) == authority)
        else:
            notice = json.loads(host.read_private(report_dir / terminal.OPEN_INTENT)[0])
            host.require(notice["deploymentId"] == binding["deploymentId"] and notice["checkpointSha256"] == binding["checkpointSha256"]
                         and notice["gateAcknowledgementSha256"] == gate_digest and notice["trafficMayHaveOpened"] is True)
            try:
                live_session = json.loads(host.read_private(report_dir / terminal.SESSION)[0])
            except FileNotFoundError:
                read_terminal()
            else:
                host.require(live_session == session)
        return authority

    def renew(actual, point):
        if (actual, point) != authority[:2]:
            return False
        if held_owner_command(root, canonical_shell(env, compose, "renewal")):
            return True
        return not marker_sealed() and read_terminal() == terminal_result

    def control(command, frame=None):
        raw, _ = native.run_native_child(root, report_dir, coordination_dir, phase, command,
                                        canonical_shell(env, compose, "control", command), stdin=frame,
                                        renewal=renew, terminal_probe=probe, deadline_ns=deadline_ns)
        reply = json.loads(raw)
        host.require(set(reply) == {"ok", "result"} and reply["ok"] is True)
        return reply["result"]

    def authorise(actual, point, held_gate):
        host.require((actual, point) == authority[:2] and held_gate == gate_ack and marker_sealed()
                     and held_owner_command(root, canonical_shell(env, compose, "public-maintenance")))
        ready = control("authorise-predecessor-role-terminal", host.json_bytes(held_gate))
        return ready["gateAcknowledgementSha256"] == gate_digest and ready["expectedTerminal"] == expected_terminal

    def open_marker(intent):
        host.require(intent["gateAcknowledgementSha256"] == gate_digest)
        result = control("open-predecessor-role-terminal")
        return result == {"intentSha256": host.digest(host.json_bytes(intent))}

    def observe_open(actual, intent):
        host.require(actual == session and not marker_sealed())
        return control("observe-predecessor-role-terminal") == {"intentSha256": host.digest(host.json_bytes(intent))}

    def observe_public(expected):
        ids = subprocess.check_output(canonical_compose(env, compose, "ps", "--all", "--quiet",
                                                        *sorted(binding["rollbackReleaseSet"])),
                                      cwd=root, stderr=subprocess.DEVNULL, timeout=30).decode("ascii").split()
        host.require(len(ids) == 6 and all(host.matches(r"[a-f0-9]{64}", value) for value in ids))
        rows = host.container_state(read_owner_json(root, (*DOCKER, "inspect", *ids)), binding["rollbackReleaseSet"])
        host.verify_runtime_graph(rows, original["containers"], environment=env)
        host.require(rows["backend"]["Id"] == runtime["backendId"] == expected["backendId"]
                     and [network["IPAddress"] for network in rows["backend"]["NetworkSettings"]["Networks"].values()] == [runtime["backendAddress"]]
                     and rows["nginx"]["Id"] == nginx["nginxId"] == expected["nginxId"]
                     and rows["nginx"]["State"]["StartedAt"] == nginx["refreshedStartedAt"]
                     and all(rows[key]["State"]["Health"]["Status"] == "healthy" for key in ("backend", "nginx")))
        observed = {}
        for origin, endpoint in zip(origins, ("/api/ready", "/")):
            raw = subprocess.check_output(("curl", "--silent", "--show-error", "--max-time", "15", "--location",
                                           "--max-redirs", "4", "--proto", "=https", "--proto-redir", "=https",
                                           "--output", "/dev/null", "--write-out", "%{http_code} %{url_effective}",
                                           "https://" + origin + endpoint), cwd=root, stderr=subprocess.DEVNULL, timeout=20)
            status, url = raw.decode("ascii").split(" ", 1)
            final = urlsplit(url)
            host.require(status == "200" and final.scheme == "https" and final.hostname == origin.lower()
                         and final.username is None and final.password is None and final.port in (None, 443))
            observed[origin] = 200
        host.require(observed == expected["origins"])
        return expected

    public = terminal.open_owned_traffic(root, report_dir, coordination_dir, phase, gate_ack, tuple(origins),
                                         authorise=authorise, remove_maintenance=open_marker,
                                         renew_without_marker=observe_open, observe_public=observe_public,
                                         before_intent=lambda: mutation_deadline(report_dir, session) == deadline_ns)
    host.require(control("finish-predecessor-role-terminal", host.json_bytes(public)) == {"phase": expected_terminal})
    return terminal.archive_terminal_holds(root, report_dir, coordination_dir, binding["deploymentId"],
                                           read_terminal=lambda _: read_terminal(), observe_public=observe_public)

def allocation_controller_password(backend, *, expected_sha256=None):
    directory = os.environ.get("DEPLOYMENT_CUSTOMER_ALLOCATION_AUTHORITY_DIR", "")
    pin = os.environ.get("DEPLOYMENT_CUSTOMER_ALLOCATION_APPROVER_SHA256", "")
    host.require(bool(directory) == bool(pin))
    if not directory:
        host.require(expected_sha256 is None)
        return b"", ""
    return host.read_controller_password(Path(directory), pin, host.backend_runtime_url(backend), expected_sha256=expected_sha256)


def installed_role_backend(root, env, compose, backend_image):
    ids = subprocess.check_output(canonical_compose(env, compose, "ps", "--all", "--quiet", "backend"),
                                  cwd=root, stderr=subprocess.DEVNULL, timeout=30).decode("ascii").split()
    host.require(len(ids) == 1 and host.matches(r"[a-f0-9]{64}", ids[0]))
    rows = read_owner_json(root, (*DOCKER, "inspect", ids[0]))
    host.require(len(rows) == 1 and rows[0]["Id"] == ids[0]
                 and rows[0]["Image"] == backend_image)
    mounts = [mount for mount in rows[0]["Mounts"] if mount["Destination"] == "/app/recovery-coordination"]
    host.require(len(mounts) == 1 and mounts[0]["RW"] is True)
    return rows[0], Path(mounts[0]["Source"])


def assert_qa_rollback_legacy_resolved(root, env, report_dir, compose, previous_sha):
    """Verify the historical legacy exit against the original QA plan."""
    host.verify_lock(root)
    host.require(compose == root / "docker-compose.rehearsal.yml" and compose.resolve(strict=True) == compose
                 and host.matches(r"[a-f0-9]{64}", previous_sha))
    session = json.loads(host.read_private(report_dir / "active-deployment-session.json")[0])
    host.require(session["purpose"] == "predecessor-role-cutover"
                 and session["phase"] in ("MUTATION_STARTED", "ROLLBACK_STARTED"))
    _, coordination = installed_role_backend(root, env, compose, session["controlImage"])
    session, _, binding = owner_context(root, env, report_dir, coordination)
    _, end = read_deadline(report_dir, session, "rollback")
    host.require(time.monotonic_ns() < end and not os.path.lexists(report_dir / "predecessor-role-cutover-open-intent.json")
                 and held_owner_command(root, canonical_shell(env, compose, "public-maintenance"))
                 and held_owner_command(root, canonical_shell(env, compose, "renewal")))
    report = root / ".deploy-state" / ("legacy-backend-drain-" + binding["deploymentId"] + ".json")

    def assert_resolved(original_env):
        command = (sys.executable, str(DIRECTORY / "legacy-backend-signal.py"),
                   "--assert-resolved", str(compose), str(original_env),
                   binding["rollbackReleaseSet"]["backend"], str(report))
        host.require(held_owner_command(root, command) and time.monotonic_ns() < end)

    current, info = host.read_private(env)
    if host.digest(current) == previous_sha:
        assert_resolved(env)
        return
    host.require(session["phase"] == "MUTATION_STARTED")
    private = (root / ".deploy-state" / ("predecessor-role-host-" + binding["deploymentId"])
               / "configuration-private.json")
    snapshot, previous = host.load_snapshot(private, env, binding)
    host.require(snapshot["previousSha256"] == previous_sha and snapshot["targetSha256"] == host.digest(current)
                 and stat.S_IMODE(info.st_mode) == snapshot["environmentMode"]
                 and info.st_gid == snapshot["environmentGid"])
    # Only the historical assertion receives these bytes. The caller's native
    # closure check and subsequent rollback still use the installed environment.
    with tempfile.TemporaryDirectory(prefix=".legacy-role-qa-", dir=report_dir) as private_dir:
        original = Path(private_dir) / "original.env"
        fd = os.open(original, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(fd, "wb") as handle:
            handle.write(previous)
        assert_resolved(original)


def launch_owned_role_cutover(root, env, report_dir, compose, phase, preflight):
    """CLI handoff from the exact canonical shell after its owned checkpoint."""
    host.require(os.geteuid() == 0 and root.resolve() == root
                 and phase in ("MUTATION_STARTED", "ROLLBACK_STARTED"))
    host.verify_lock(root)
    session = json.loads(host.read_private(report_dir / "active-deployment-session.json")[0])
    host.require(session["phase"] == phase and session["purpose"] == "predecessor-role-cutover"
                 and session["deploymentId"] == os.environ.get("DEPLOYMENT_ID"))
    host.require(compose.parent == root and compose.resolve() == compose and compose.is_file()
                 and (compose.name == "docker-compose.prod.yml" or (
                     compose.name == "docker-compose.rehearsal.yml"
                     and os.environ.get("DEPLOYMENT_QA_REHEARSAL_PLAN_FILE")
                     and host.matches(r"[a-f0-9]{64}", os.environ.get("DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256")))))
    backend, coordination = installed_role_backend(root, env, compose, preflight["images"]["backend"])
    credential = None
    try:
        if phase == "MUTATION_STARTED":
            credential = os.memfd_create("sabalan-role-cutover", os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
            runtime = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=")
            authority_sha256 = os.environ.get("ROLE_CUTOVER_AUTHORITY_SHA256", "")
            require_controller = session.get("allocationControllerProvisioning") is True
            host.require((host.matches(r"[a-f0-9]{64}", authority_sha256) if require_controller else authority_sha256 == ""))
            controller, observed_sha256 = allocation_controller_password(backend, expected_sha256=authority_sha256 or None)
            host.require(observed_sha256 == authority_sha256 and bool(controller) == require_controller)
            host.require(runtime != controller)
            payload = runtime + controller
            host.require(os.write(credential, payload) == len(payload))
            fcntl.fcntl(credential, fcntl.F_ADD_SEALS, host.REQUIRED_CREDENTIAL_SEALS)
        outcome = run_canonical_foreground(root, env, report_dir, coordination, preflight, credential, compose=compose)
        return publish_canonical_terminal(root, env, report_dir, coordination, outcome["gateAcknowledgement"], compose=compose)
    finally:
        if credential is not None:
            os.close(credential)


if __name__ == "__main__":
    try:
        if len(sys.argv) == 7 and sys.argv[1] == "--assert-qa-rollback-legacy-resolved":
            root, env, report_dir, compose = map(Path, sys.argv[2:6])
            assert_qa_rollback_legacy_resolved(root, env, report_dir, compose, sys.argv[6])
            sys.exit(0)
        if len(sys.argv) == 4 and sys.argv[1] == "--controller-authority-preflight":
            root = Path(sys.argv[2])
            host.verify_lock(root)
            backend_id = sys.argv[3]
            host.require(os.geteuid() == 0 and host.matches(r"[a-f0-9]{64}", backend_id))
            rows = read_owner_json(root, (*DOCKER, "inspect", backend_id))
            host.require(len(rows) == 1 and rows[0]["Id"] == backend_id)
            _, authority_sha256 = allocation_controller_password(rows[0])
            host.require(bool(authority_sha256))
            print(authority_sha256)
            sys.exit(0)
        if len(sys.argv) == 7 and sys.argv[1] == "--clock":
            verb, root, reports, kind, value = sys.argv[2:]
            if verb == "start":
                start_deadline(Path(root), Path(reports), kind, int(value))
            else:
                host.require(verb == "closed" and kind == "checkpoint")
                close_checkpoint_deadline(Path(root), Path(reports), int(value))
            sys.exit(0)
        host.require(len(sys.argv) == 6 and not sys.stdin.isatty())
        root, env, report_dir, compose = map(Path, sys.argv[1:5])
        frame = sys.stdin.buffer.read(65537)
        host.require(0 < len(frame) <= 65536)
        print(json.dumps(launch_owned_role_cutover(root, env, report_dir, compose, sys.argv[5], json.loads(frame))))
    except Exception:
        print("PREDECESSOR_ROLE_CUTOVER_CONTROLLED_RECOVERY_REQUIRED", file=sys.stderr)
        sys.exit(1)

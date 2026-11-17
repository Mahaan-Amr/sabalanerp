"""Concrete native command factories for the protected role configuration owner.

This adapter is import-only. It assumes the canonical runner already owns its
host lock, PostgreSQL advisory session, maintenance marker and deployment lease.
"""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


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
                           renewal, maintenance, restart, wait_for_healthy):
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
        host.verify_runtime_graph(rows, original["containers"])
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


def start_original_siblings(root, report_dir, coordination_dir, phase, proof, planned, *, inspect, renewal, maintenance):
    session, checkpoint, binding = host.context(root, report_dir, coordination_dir, phase)
    private, _ = host.transaction_paths(root, binding["deploymentId"])
    original = json.loads(host.read_private(private.with_name("backend-runtime-preimage.json"))[0])
    host.require(original["binding"] == binding and maintenance() is True and renewal(session, checkpoint) is True)

    def inspect_original():
        rows = host.container_state(inspect(), binding["rollbackReleaseSet"])
        host.verify_runtime_graph(rows, original["containers"])
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
                                (*DOCKER, "start", *stopped), renewal=renewal)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        host.require(renewal(session, checkpoint) is True and maintenance() is True)
        rows = inspect_original()
        if all(rows[name]["State"]["Running"] is True and rows[name]["State"]["Health"]["Status"] == "healthy" for name in names):
            return
        time.sleep(1)
    host.require(False)


def run_canonical_foreground(root, env, report_dir, coordination_dir, preflight, credential_fd):
    """Run the already-owned configuration continuation through native transports."""
    session, checkpoint, binding = owner_context(root, env, report_dir, coordination_dir)
    phase = session["phase"]
    compose = root / "docker-compose.prod.yml"
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
        renewal=lambda actual, point: renew(actual, point) and maintenance(),
        observe=observe, inspect=inspect, compose_argv=compose_argv,
        control_argv=lambda command, args: canonical_shell(env, compose, "control", command, *args),
    )

    start_original_siblings(root, report_dir, coordination_dir, phase, proof, preflight["containers"],
                            inspect=inspect, renewal=renew, maintenance=maintenance)

    def restart(identifier):
        native.run_native_child(root, report_dir, coordination_dir, phase, "refresh-nginx",
                                (*DOCKER, "restart", "--time", "30", identifier), renewal=renew)
        return True

    def wait_for_health():
        until = time.monotonic() + 60
        while time.monotonic() < until:
            host.require(renew(session, checkpoint))
            rows = host.container_state(inspect(), graph)
            if rows["nginx"]["State"]["Health"]["Status"] == "healthy":
                return
            time.sleep(1)
        host.require(False)

    nginx = refresh_original_nginx(root, report_dir, coordination_dir, phase, proof, preflight["containers"]["nginx"],
                                   inspect=inspect, renewal=renew, maintenance=maintenance, restart=restart,
                                   wait_for_healthy=wait_for_health)
    original = json.loads(host.read_private(private.with_name("backend-runtime-preimage.json"))[0])
    host.require(original["binding"] == binding)
    final_rows = host.container_state(inspect(), graph)
    host.verify_runtime_graph(final_rows, original["containers"])
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
                                       canonical_shell(env, compose, "gates", mode), renewal=renew, budget_seconds=600)

    gate_proof = acknowledge_role_gates(root, report_dir, coordination_dir, phase, proof, nginx,
                                        gates=gates, verify_current=prove_current_graph, renewal=renew,
                                        maintenance=maintenance)
    return {"runtimeProof": proof, "nginxProof": nginx, "gateAcknowledgement": gate_proof, "canOpenTraffic": False}

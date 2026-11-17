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
    return {"runtimeProof": proof, "nginxProof": nginx, "canOpenTraffic": False}

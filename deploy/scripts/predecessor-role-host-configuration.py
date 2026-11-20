"""Private host filesystem transaction for the first predecessor role split.

The protected lifecycle owner supplies live observations and owns lease renewal,
database credential activation, service recreation, and all reopening decisions.
Import-only: a caller cannot select this operation from the normal deploy CLI.
"""

import base64
import copy
import fcntl
import hashlib
from ipaddress import IPv4Address
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit


RUNTIME_USER = "sabalan_application_runtime"
CONTROLLER = "sabalan_allocation_controller"
SERVICES = {"backend", "frontend", "inquiry", "nginx", "postgres", "clamav"}
MAX_PRIVATE_BYTES = 8 * 1024 * 1024
REQUIRED_CREDENTIAL_SEALS = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK


class RoleHostConfigurationError(RuntimeError):
    pass


def require(condition):
    if not condition:
        raise RoleHostConfigurationError("PREDECESSOR_ROLE_HOST_CONFIGURATION_UNPROVEN")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def matches(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def private_directory(path):
    info = path.lstat()
    require(path.is_absolute() and path.resolve() == path and stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.geteuid() and not info.st_mode & 0o022)


def read_private(path):
    private_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                and before.st_nlink == 1 and not before.st_mode & 0o077
                and 0 < before.st_size <= MAX_PRIVATE_BYTES)
        with os.fdopen(fd, "rb", closefd=False) as handle:
            raw = handle.read(MAX_PRIVATE_BYTES + 1)
        after = os.fstat(fd)
        named = path.lstat()
        pin = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
        require(pin(before) == pin(after) == pin(named) and len(raw) == before.st_size)
        return raw, before
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_private(path, raw, *, original=None):
    require(0 < len(raw) <= MAX_PRIVATE_BYTES)
    private_directory(path.parent)
    fd, temporary = tempfile.mkstemp(prefix=".role-config-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            if original is not None:
                os.fchown(handle.fileno(), -1, original.st_gid)
                os.fchmod(handle.fileno(), stat.S_IMODE(original.st_mode))
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")


def verify_lock(root):
    path = root / ".deploy-state/deployment.lock"
    private_directory(path.parent)
    fd = os.fstat(9)
    named = path.lstat()
    require(os.readlink("/proc/self/fd/9") == str(path)
            and stat.S_ISREG(fd.st_mode) and fd.st_uid == os.geteuid()
            and not fd.st_mode & 0o022 and fd.st_nlink == 1
            and (fd.st_dev, fd.st_ino) == (named.st_dev, named.st_ino))
    details = Path("/proc/self/fdinfo/9").read_text()
    require(re.search(r"^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:"
                      + str(fd.st_ino) + r"\s+0\s+EOF\s*$", details, re.MULTILINE))


def valid_credential(password):
    return (re.fullmatch(rb"[A-Za-z0-9_-]{43}", password)
            and base64.urlsafe_b64encode(base64.urlsafe_b64decode(password + b"=")).rstrip(b"=") == password)


def read_credentials(fd):
    require(fd != 9 and os.readlink(f"/proc/self/fd/{fd}").startswith("/memfd:")
            and fcntl.fcntl(fd, fcntl.F_GET_SEALS) & REQUIRED_CREDENTIAL_SEALS == REQUIRED_CREDENTIAL_SEALS)
    payload = os.pread(fd, 87, 0)
    runtime, controller = payload[:43], payload[43:]
    require(valid_credential(runtime) and (not controller or (valid_credential(controller) and controller != runtime)))
    return runtime, controller


def read_controller_password(directory, approver_sha256, installed_url, *, expected_sha256=None):
    info = directory.lstat()
    require(not info.st_mode & 0o077)
    raw, _ = read_private(directory / "authority.json")
    require(len(raw) <= 16 * 1024)
    authority_sha256 = digest(raw)
    require(expected_sha256 is None or authority_sha256 == expected_sha256)
    authority = json.loads(raw)
    require(set(authority) == {"allocationControllerUrl", "keyId", "publicKeyPem"})
    approver = authority["publicKeyPem"]
    key_id = authority["keyId"]
    require(isinstance(approver, str) and digest(approver.encode()) == approver_sha256
            and isinstance(key_id, str) and key_id and key_id == key_id.strip())
    pem = re.fullmatch(r"-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/]{59}=)\r?\n-----END PUBLIC KEY-----(?:\r?\n)?", approver)
    require(pem is not None)
    # Ed25519 SubjectPublicKeyInfo has this fixed DER header followed by 32 public key bytes.
    public_key = base64.b64decode(pem[1], validate=True)
    require(len(public_key) == 44 and public_key.startswith(bytes.fromhex("302a300506032b6570032100")))
    url = urlsplit(authority["allocationControllerUrl"])
    installed = urlsplit(installed_url)
    settings = parse_qs(url.query, keep_blank_values=True, strict_parsing=True)
    require(url.scheme in ("postgresql", "postgres") and url.username == CONTROLLER and not url.fragment
            and (url.hostname, url.port, url.path) == (installed.hostname, installed.port, installed.path)
            and matches(r"/[A-Za-z0-9_]+", url.path)
            and set(settings) <= {"schema", "connection_limit", "pool_timeout", "application_name"}
            and settings.get("schema") == ["public"]
            and all(len(settings.get(name, [])) == 1 and matches(r"[1-9][0-9]*", settings[name][0])
                    for name in ("connection_limit", "pool_timeout"))
            and matches(r"[A-Za-z0-9_-]{43}", url.password)
            and url.password != unquote(installed.password or ""))
    password = url.password.encode("ascii")
    require(valid_credential(password))
    return password, authority_sha256


def context(root, report_dir, coordination_dir, phase):
    verify_lock(root)
    session = json.loads(read_private(report_dir / "active-deployment-session.json")[0])
    marker = json.loads(read_private(coordination_dir / "deployment-maintenance.json")[0])
    checkpoint = json.loads(read_private(coordination_dir / "deployment-checkpoint.json")[0])
    identity = {key: session[key] for key in ("deploymentId", "releaseId", "targetCommit", "rollbackReleaseSet")}
    graph = identity["rollbackReleaseSet"]
    require(session["phase"] == phase and session["bootstrap"] is False
            and session["purpose"] == "predecessor-role-cutover"
            and all(matches(r"[A-Za-z0-9_-]{1,160}", identity[key]) for key in ("deploymentId", "releaseId"))
            and matches(r"[a-f0-9]{40}", identity["targetCommit"])
            and set(graph) == SERVICES and all(matches(r"sha256:[a-f0-9]{64}", image) for image in graph.values())
            and session["controlImage"] == graph["backend"]
            and session["preservedClamav"]["selection"]["image"] == graph["clamav"]
            and all(marker[key] == identity[key] for key in ("deploymentId", "releaseId"))
            and all(checkpoint[key] == value for key, value in identity.items())
            and all(checkpoint[key] is True for key in ("localVerified", "remoteVerified", "localRestoreVerified"))
            and matches(r"[a-f0-9]{64}", checkpoint["checksum"])
            and matches(r"[a-f0-9]{64}", checkpoint["canonicalMetadataSha256"]))
    binding = {**identity, "checkpointSha256": checkpoint["checksum"],
               "checkpointMetadataSha256": checkpoint["canonicalMetadataSha256"],
               "scannerBindingSha256": digest(json_bytes(session["preservedClamav"]).rstrip(b"\n"))}
    return session, checkpoint, binding


def assert_stage(raw, binding, checkpoint):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 16384)
    proof = json.loads(raw)
    receipt = proof["roleCutover"]
    require(set(proof) == {"ok", "roleCutover"} and set(receipt) == {
        "format", "outcome", "deploymentId", "releaseId", "controlImage", "checkpointSha256",
        "checkpointMetadataSha256", "sourceDatabase", "catalogSha256", "migrationSha256", "migrations",
        "tables", "views", "sequences", "securityDefinerRoutines", "preimageSha256", "stagedAclSha256",
    } and proof["ok"] is True and receipt["format"] == "sabalan-predecessor-role-acl-cutover-v1"
            and receipt["outcome"] in ("staged", "already-staged")
            and receipt["controlImage"] == binding["rollbackReleaseSet"]["backend"]
            and receipt["sourceDatabase"] == checkpoint["sourceDatabase"]
            and all(receipt[key] == binding[key] for key in (
                "deploymentId", "releaseId", "checkpointSha256", "checkpointMetadataSha256"))
            and all(matches(r"[a-f0-9]{64}", receipt[key]) for key in (
                "checkpointMetadataSha256", "catalogSha256", "migrationSha256",
                "preimageSha256", "stagedAclSha256")))
    return receipt


def candidate_bytes(original, password):
    # Retain the original as a verbatim prefix, including comments and EOF.
    # A rendered-model comparison checks interpolation and rejects overrides.
    require(b"\0" not in original and not re.search(
        rb"^\s*(?:export[ \t]+)?BACKEND_DATABASE_(?:USER|PASSWORD)[ \t]*[=:]", original, re.MULTILINE))
    eol = b"\r\n" if b"\r\n" in original else b"\n"
    separator = b"" if original.endswith(b"\n") else eol
    return original + separator + b"BACKEND_DATABASE_USER=" + RUNTIME_USER.encode() + eol + (
        b"BACKEND_DATABASE_PASSWORD=" + password + eol)


def verify_legacy(model, graph, installed, expected_graph, allowed_runtime=None):
    require(model["name"] == "sabalanerp" and graph == expected_graph)
    services = model["services"]
    require(all(services[name]["image"] == expected_graph[name] for name in SERVICES - {"clamav"}))
    runtime = services["backend"]["environment"]["DATABASE_URL"]
    control = services["deployment"]["environment"]
    postgres = services["postgres"]["environment"]
    user = postgres["POSTGRES_USER"]
    require(matches(r"[A-Za-z0-9_]+", user) and user not in (RUNTIME_USER, CONTROLLER)
            and control["DEPLOYMENT_CHECKPOINT_RUNTIME_USER"] == user
            and services["deployment"]["image"] == expected_graph["backend"]
            and runtime == control["DATABASE_URL"]
            and (installed == runtime or (allowed_runtime is not None and digest(installed.encode()) == allowed_runtime)))
    url = urlsplit(runtime)
    params = parse_qs(url.query, strict_parsing=True, keep_blank_values=True)
    require(url.scheme == "postgresql" and url.netloc.rsplit("@", 1)[1] == "postgres:5432" and not url.fragment
            and unquote(url.username) == user and url.password
            and postgres["POSTGRES_PASSWORD"] in (url.password, unquote(url.password))
            and matches(r"[A-Za-z0-9_]+", postgres["POSTGRES_DB"]) and url.path == "/" + postgres["POSTGRES_DB"]
            and params.get("schema") == ["public"]
            and set(params) <= {"schema", "connection_limit", "pool_timeout", "application_name"}
            and all(len(params.get(key, ())) == 1 and matches(r"[1-9][0-9]*", params[key][0])
                    for key in ("connection_limit", "pool_timeout")))
    return runtime, url


def transaction_paths(root, deployment_id):
    directory = root / ".deploy-state" / ("predecessor-role-host-" + deployment_id)
    directory.mkdir(mode=0o700, exist_ok=True)
    private_directory(directory)
    require(not directory.stat().st_mode & 0o077)
    sync_directory(directory.parent)
    return directory / "configuration-private.json", directory / "receipt.json"


def load_snapshot(private_path, env, binding):
    saved = json.loads(read_private(private_path)[0])
    previous = base64.b64decode(saved["previous"], validate=True)
    require(saved["binding"] == binding and saved["environment"] == str(env)
            and saved["previousSha256"] == digest(previous))
    return saved, previous


def require_current_environment(env, expected, snapshot):
    current, metadata = read_private(env)
    require(current == expected and stat.S_IMODE(metadata.st_mode) == snapshot["environmentMode"]
            and metadata.st_gid == snapshot["environmentGid"])


def publish_receipt(path, binding, stage_digest, state):
    receipt = {"format": "sabalan-predecessor-role-host-config-v1", **binding,
               "stageReceiptSha256": stage_digest, "state": state}
    write_private(path, json_bytes(receipt))
    return receipt


def hold_credential_activation(root, binding, stage):
    marker = root / ".deploy-state/predecessor-role-cutover-active.json"
    raw = json_bytes({
        "format": "sabalan-predecessor-role-cutover-host-hold/v1",
        "deploymentId": binding["deploymentId"],
        "releaseId": binding["releaseId"],
        "checkpointMetadataSha256": binding["checkpointMetadataSha256"],
        "stagedAclSha256": stage["stagedAclSha256"],
    })
    try:
        require(read_private(marker)[0] == raw)
    except FileNotFoundError:
        write_private(marker, raw)


def activate_login(root, report_dir, coordination_dir, credential_fd, stage_receipt, *, invoke):
    """Pass a sealed credential to the original protected control command by stdin.

    invoke must run the owned one-off deployment service in the foreground and
    return its parsed redacted result. The frame must never enter argv or env.
    """
    try:
        phase = "MUTATION_STARTED"
        authority = context(root, report_dir, coordination_dir, phase)
        stage = assert_stage(stage_receipt, authority[2], authority[1])
        runtime, controller = read_credentials(credential_fd)
        provisioning = authority[0].get("allocationControllerProvisioning") is True
        require(bool(controller) == provisioning)
        hold_credential_activation(root, authority[2], stage)
        proof = invoke(stage["stagedAclSha256"].encode("ascii") + runtime + controller)
        receipt = proof["roleCutover"]
        require(set(proof) == {"ok", "roleCutover"} and proof["ok"] is True and receipt["outcome"] in ("login-activated", "login-already-active")
                and receipt == {**stage, "outcome": receipt["outcome"],
                                **({"controllerProvisioned": True} if provisioning else {})})
        require(context(root, report_dir, coordination_dir, phase) == authority)
        return proof
    except Exception:
        raise RoleHostConfigurationError("PREDECESSOR_ROLE_HOST_CONFIGURATION_UNPROVEN") from None


def apply(root, env, report_dir, coordination_dir, credential_fd, stage_receipt, *, observe, verify_boundary):
    """Apply a previously staged and authenticated split under MUTATION_STARTED.

    observe(exact_environment_bytes) must render the supplied bytes privately and
    check the unchanged live installed graph, including scanner preservation. It
    returns the Compose model, observed immutable ID map and installed runtime URL.
    verify_boundary(session, checkpoint, stage_receipt) must raise or return True
    after verifying live lease, bound checkpoint, exact stage receipt and initial
    runtime credential activation. Neither callback may publish secret input.
    """
    try:
        return _apply(root, env, report_dir, coordination_dir, credential_fd, stage_receipt,
                      observe=observe, verify_boundary=verify_boundary)
    except Exception:
        raise RoleHostConfigurationError("PREDECESSOR_ROLE_HOST_CONFIGURATION_UNPROVEN") from None


def _apply(root, env, report_dir, coordination_dir, credential_fd, stage_receipt, *, observe, verify_boundary):
    phase = "MUTATION_STARTED"
    session, checkpoint, binding = context(root, report_dir, coordination_dir, phase)
    stage = assert_stage(stage_receipt, binding, checkpoint)
    require(verify_boundary(session, checkpoint, stage_receipt) is True)
    password, _ = read_credentials(credential_fd)
    current, metadata = read_private(env)
    private_path, receipt_path = transaction_paths(root, binding["deploymentId"])
    stage_digest = digest(stage_receipt)
    saved = None
    previous = current
    if private_path.exists():
        saved, previous = load_snapshot(private_path, env, binding)
        require(saved["stageReceiptSha256"] == stage_digest)
    target = candidate_bytes(previous, password)
    require(current in (previous, target))
    graph = binding["rollbackReleaseSet"]
    before, before_graph, installed = observe(previous)
    runtime, url = verify_legacy(before, before_graph, installed, graph,
                                 saved["targetRuntimeSha256"] if saved else None)
    require(stage["sourceDatabase"]["name"] == url.path[1:]
            and password.decode() not in (url.password, unquote(url.password)))
    suffix = runtime[len("postgresql://" + url.netloc):]
    target_runtime = f"postgresql://{RUNTIME_USER}:{password.decode()}@postgres:5432{suffix}"
    intended = copy.deepcopy(before)
    intended["services"]["backend"]["environment"]["DATABASE_URL"] = target_runtime
    intended["services"]["deployment"]["environment"]["DEPLOYMENT_CHECKPOINT_RUNTIME_USER"] = RUNTIME_USER
    rendered, rendered_graph, rendered_installed = observe(target)
    require(rendered == intended and rendered_graph == graph and rendered_installed == installed)
    snapshot = {"binding": binding, "environment": str(env), "stageReceiptSha256": stage_digest,
                "previous": base64.b64encode(previous).decode(), "previousSha256": digest(previous),
                "targetSha256": digest(target), "targetRuntimeSha256": digest(target_runtime.encode()),
                "previousRuntimeSha256": digest(runtime.encode()), "previousRuntimeUser": unquote(url.username),
                "baselineModelSha256": digest(json_bytes(before)),
                "environmentMode": stat.S_IMODE(metadata.st_mode), "environmentGid": metadata.st_gid}
    if saved:
        require(saved == snapshot)
    else:
        write_private(private_path, json_bytes(snapshot))
    require(context(root, report_dir, coordination_dir, phase) == (session, checkpoint, binding))
    require(verify_boundary(session, checkpoint, stage_receipt) is True)
    require(context(root, report_dir, coordination_dir, phase) == (session, checkpoint, binding))
    require_current_environment(env, current, snapshot)
    if current != target:
        write_private(env, target, original=metadata)
    require_current_environment(env, target, snapshot)
    return publish_receipt(receipt_path, binding, stage_digest, "APPLIED")


def restore(root, env, report_dir, coordination_dir, *, observe, verify_boundary):
    """Restore original bytes under ROLLBACK_STARTED, including an interrupted apply.

    On rollback verify_boundary must authenticate the live rollback lease and its
    original verified checkpoint. Restoring this file cannot authorize traffic.
    """
    try:
        return _restore(root, env, report_dir, coordination_dir, observe=observe, verify_boundary=verify_boundary)
    except Exception:
        raise RoleHostConfigurationError("PREDECESSOR_ROLE_HOST_CONFIGURATION_UNPROVEN") from None


def _restore(root, env, report_dir, coordination_dir, *, observe, verify_boundary):
    require(not os.path.lexists(report_dir / "predecessor-role-cutover-open-intent.json"))
    phase = "ROLLBACK_STARTED"
    session, checkpoint, binding = context(root, report_dir, coordination_dir, phase)
    require(verify_boundary(session, checkpoint, None) is True)
    private_path, receipt_path = transaction_paths(root, binding["deploymentId"])
    saved, previous = load_snapshot(private_path, env, binding)
    current, metadata = read_private(env)
    require(current == previous or digest(current) == saved["targetSha256"])
    model, graph, installed = observe(previous)
    require(digest(json_bytes(model)) == saved["baselineModelSha256"])
    verify_legacy(model, graph, installed, binding["rollbackReleaseSet"], saved["targetRuntimeSha256"])
    require(context(root, report_dir, coordination_dir, phase) == (session, checkpoint, binding))
    require(verify_boundary(session, checkpoint, None) is True)
    require(context(root, report_dir, coordination_dir, phase) == (session, checkpoint, binding))
    require_current_environment(env, current, saved)
    if current != previous:
        write_private(env, previous, original=metadata)
    require_current_environment(env, previous, saved)
    return publish_receipt(receipt_path, binding, saved["stageReceiptSha256"], "RESTORED")


def container_state(rows, graph):
    require(len(rows) == len(SERVICES))
    containers = {}
    for row in rows:
        labels = row["Config"]["Labels"]
        service = labels["com.docker.compose.service"]
        require(service in SERVICES and service not in containers and labels["com.docker.compose.project"] == "sabalanerp"
                and row["Image"] == graph[service] and matches(r"[a-f0-9]{64}", row["Id"]))
        containers[service] = row
    return containers


def backend_runtime_url(row):
    entries = [entry.removeprefix("DATABASE_URL=") for entry in row["Config"]["Env"] if entry.startswith("DATABASE_URL=")]
    require(len(entries) == 1)
    return entries[0]


def container_config_digest(row):
    config = copy.deepcopy(row["Config"])
    if config["Hostname"] == row["Id"][:12]:
        config["Hostname"] = ""
    for label in ("com.docker.compose.config-hash", "com.docker.compose.replace"):
        config["Labels"].pop(label, None)
    environment = {}
    for entry in config["Env"]:
        key, value = entry.split("=", 1)
        require(key and key not in environment)
        environment[key] = "" if key == "DATABASE_URL" and config["Labels"]["com.docker.compose.service"] == "backend" else value
    config["Env"] = environment
    host = copy.deepcopy(row["HostConfig"])
    if host.get("Binds") is not None:
        host["Binds"].sort()
    networks = {}
    for name, value in row["NetworkSettings"]["Networks"].items():
        aliases = value.get("Aliases") or []
        networks[name] = {key: value.get(key) for key in ("NetworkID", "IPAMConfig", "Links", "DriverOpts")}
        networks[name]["Aliases"] = sorted(alias for alias in aliases if alias not in (row["Id"], row["Id"][:12]))
    return digest(json_bytes({
        "config": config, "host": host, "mounts": sorted(row["Mounts"], key=lambda mount: mount["Destination"]),
        "networks": networks,
    }))


def original_graph(containers):
    return {
        name: {"id": row["Id"], "created": row["Created"], "configSha256": container_config_digest(row),
               **({"startedAt": row["State"]["StartedAt"], "pid": row["State"]["Pid"]} if name == "clamav" else {})}
        for name, row in containers.items()
    }


def verify_runtime_graph(containers, original, *, environment):
    actual = original_graph(containers)
    require(all(actual[name] == original[name] for name in SERVICES - {"backend"}))
    expected = original["backend"]["configSha256"]
    if actual["backend"]["configSha256"] != expected:
        # Compose --no-deps empties this label. Its two dependencies can appear in either order.
        backend = copy.deepcopy(containers["backend"])
        labels = backend["Config"]["Labels"]
        depends = "com.docker.compose.depends_on"
        env_label = "com.docker.compose.project.environment_file"
        require(labels.get(env_label) == str(environment) and labels.get(depends) == "")
        dependencies = ("clamav:service_healthy:false,postgres:service_healthy:false",
                        "postgres:service_healthy:false,clamav:service_healthy:false")

        def matches_original_dependencies():
            for value in dependencies:
                labels[depends] = value
                if container_config_digest(backend) == expected:
                    return True
            return False

        if not matches_original_dependencies():
            # QA may use an owned private copy of the source environment file.
            original_env = containers["frontend"]["Config"]["Labels"].get(env_label, "")
            qa_root = Path("/srv/sabalanerp-qa")
            require(environment.is_relative_to(qa_root) and Path(original_env).is_relative_to(qa_root)
                    and original_env == containers["inquiry"]["Config"]["Labels"].get(env_label)
                    and original_env == containers["nginx"]["Config"]["Labels"].get(env_label))
            labels[env_label] = original_env
            require(matches_original_dependencies())
    scanner = containers["clamav"]["State"]
    require(scanner["Running"] is True and scanner["Health"]["Status"] == "healthy")


def backend_observation(containers):
    row = containers["backend"]
    state = row["State"]
    return (original_graph(containers), digest(backend_runtime_url(row).encode()), state["StartedAt"],
            state["Pid"], state["Running"], state["Restarting"], state["Dead"], state["Health"]["Status"],
            sorted((name, network["IPAddress"]) for name, network in row["NetworkSettings"]["Networks"].items()))


def continue_backend(root, env, report_dir, coordination_dir, pinned_containers, *, inspect, recreate_backend,
                     verify_boundary, prove_role):
    """Continue only the pinned backend under the owned protected runner.

    The owner supplies the plan-pinned IDs, a native Docker inspector and a
    foreground command that does not return until its original child has closed.
    The live boundary verifier must confirm lease, checkpoint and maintenance.
    The role verifier must prove authentication from this backend's address on
    the checkpointed database and confirm the phase-appropriate ACL boundary.
    This receipt carries no admission to reopen traffic or finish the lease.
    """
    try:
        return _continue_backend(root, env, report_dir, coordination_dir, pinned_containers,
                                 inspect=inspect, recreate_backend=recreate_backend,
                                 verify_boundary=verify_boundary, prove_role=prove_role)
    except Exception:
        raise RoleHostConfigurationError("PREDECESSOR_ROLE_HOST_RUNTIME_UNPROVEN") from None


def _continue_backend(root, env, report_dir, coordination_dir, pinned_containers, *, inspect, recreate_backend,
                      verify_boundary, prove_role):
    verify_lock(root)
    phase = json.loads(read_private(report_dir / "active-deployment-session.json")[0])["phase"]
    require(phase in ("MUTATION_STARTED", "ROLLBACK_STARTED"))
    authority = context(root, report_dir, coordination_dir, phase)
    session, checkpoint, binding = authority
    restoring = phase == "ROLLBACK_STARTED"
    require(not restoring or not os.path.lexists(report_dir / "predecessor-role-cutover-open-intent.json"))
    require(verify_boundary(session, checkpoint) is True)
    private_path, receipt_path = transaction_paths(root, binding["deploymentId"])
    saved, previous = load_snapshot(private_path, env, binding)
    expected_host_state = "RESTORED" if restoring else "APPLIED"
    receipt = json.loads(read_private(receipt_path)[0])
    require(receipt == {"format": "sabalan-predecessor-role-host-config-v1", **binding,
                        "stageReceiptSha256": saved["stageReceiptSha256"], "state": expected_host_state})
    current = read_private(env)[0]
    require(current == previous if restoring else digest(current) == saved["targetSha256"])
    require_current_environment(env, current, saved)

    graph = binding["rollbackReleaseSet"]
    get_graph = lambda: container_state(inspect(), graph)
    containers = get_graph()
    baseline_path = private_path.with_name("backend-runtime-preimage.json")
    try:
        baseline = json.loads(read_private(baseline_path)[0])
    except FileNotFoundError:
        require({name: row["Id"] for name, row in containers.items()} == pinned_containers
                and digest(backend_runtime_url(containers["backend"]).encode()) == saved["previousRuntimeSha256"])
        baseline = {"binding": binding, "containers": original_graph(containers)}
        write_private(baseline_path, json_bytes(baseline))
    original = baseline["containers"]
    require(baseline["binding"] == binding and {name: row["id"] for name, row in original.items()} == pinned_containers)
    verify_runtime_graph(containers, original, environment=env)

    expected_runtime = saved["previousRuntimeSha256"] if restoring else saved["targetRuntimeSha256"]
    backend = containers["backend"]
    observed_runtime = digest(backend_runtime_url(backend).encode())
    require(observed_runtime in (saved["previousRuntimeSha256"], saved["targetRuntimeSha256"]))
    if observed_runtime != expected_runtime or backend["State"]["Running"] is not True:
        # The protected runner must have drained the previous backend. A prior
        # uncertain attempt can only be observed, never replayed automatically.
        require(backend["State"]["Running"] is False)
        intent_path = private_path.with_name("backend-runtime-" + expected_host_state.lower() + "-intent.json")
        require(not os.path.lexists(intent_path))
        require(context(root, report_dir, coordination_dir, phase) == authority)
        require(verify_boundary(session, checkpoint) is True)
        require(backend_observation(get_graph()) == backend_observation(containers))
        require_current_environment(env, current, saved)
        write_private(intent_path, json_bytes({**binding, "beforeBackendId": backend["Id"], "state": expected_host_state}))
        require(recreate_backend(("up", "-d", "--no-deps", "--no-build", "--force-recreate", "--pull", "never",
                                  "--wait", "--wait-timeout", "180", "backend")) is True)
        containers = get_graph()
        verify_runtime_graph(containers, original, environment=env)
        require(containers["backend"]["Id"] != backend["Id"])
        backend = containers["backend"]

    require(backend["State"]["Running"] is True and backend["State"]["Health"]["Status"] == "healthy"
            and backend["State"]["Restarting"] is False and backend["State"]["Dead"] is False
            and (restoring or backend["Id"] != pinned_containers["backend"])
            and digest(backend_runtime_url(backend).encode()) == expected_runtime)
    networks = list(backend["NetworkSettings"]["Networks"].values())
    require(len(networks) == 1)
    address = str(IPv4Address(networks[0]["IPAddress"]))
    expected_proof = {"deploymentId": binding["deploymentId"], "checkpointSha256": binding["checkpointSha256"],
                      "backendId": backend["Id"], "backendAddress": address,
                      "role": saved["previousRuntimeUser"] if restoring else RUNTIME_USER}
    if not restoring and session.get("allocationControllerProvisioning") is True:
        expected_proof["controllerProvisioned"] = True
    require(prove_role(expected_proof.copy()) == expected_proof)
    require(context(root, report_dir, coordination_dir, phase) == authority)
    require(verify_boundary(session, checkpoint) is True)
    require(backend_observation(get_graph()) == backend_observation(containers))
    require_current_environment(env, current, saved)
    proof = {"format": "sabalan-predecessor-role-host-runtime-v1", **expected_proof,
             "backendImage": graph["backend"], "state": expected_host_state, "canOpenTraffic": False}
    write_private(private_path.with_name("backend-runtime-" + expected_host_state.lower() + "-proof.json"), json_bytes(proof))
    return proof

def foreground(root, env, report_dir, coordination_dir, preflight, credential_fd, *, control,
               verify_boundary, observe, inspect, recreate_backend):
    """Compose the protected same-image operation through its foreground owner.

    The caller owns the existing deployment lock, advisory session, maintenance
    boundary, and lease. control must use the canonical foreground one-off runner
    with the given command and args. A binary input is used only for LOGIN.
    This continuation neither authorizes public traffic nor finalizes the lease.
    """
    try:
        return _foreground(root, env, report_dir, coordination_dir, preflight, credential_fd, control=control,
                           verify_boundary=verify_boundary, observe=observe, inspect=inspect, recreate_backend=recreate_backend)
    except Exception:
        raise RoleHostConfigurationError("PREDECESSOR_ROLE_FOREGROUND_UNPROVEN") from None


def _foreground(root, env, report_dir, coordination_dir, preflight, credential_fd, *, control,
                verify_boundary, observe, inspect, recreate_backend):
    verify_lock(root)
    phase = json.loads(read_private(report_dir / "active-deployment-session.json")[0])["phase"]
    require(phase in ("MUTATION_STARTED", "ROLLBACK_STARTED"))
    session, checkpoint, binding = context(root, report_dir, coordination_dir, phase)
    restoring = phase == "ROLLBACK_STARTED"
    require(not restoring or not os.path.lexists(report_dir / "predecessor-role-cutover-open-intent.json"))
    require(verify_boundary(session, checkpoint) is True)
    require(set(preflight) == {
        "format", "sourceCommit", "sourceHash", "browserBuildId", "images", "containers",
        "preservedClamavSelectionSha256", "databaseTopology", "canMutate", "canOpenTraffic", "planSha256",
    } and preflight["format"] == "sabalan-predecessor-role-cutover-preflight/v1"
        and preflight["sourceCommit"] == binding["targetCommit"]
        and preflight["images"] == binding["rollbackReleaseSet"]
        and preflight["preservedClamavSelectionSha256"] == session["preservedClamav"]["selectionSha256"]
        and preflight["databaseTopology"] == "legacy" and preflight["canMutate"] is False and preflight["canOpenTraffic"] is False
        and all(matches(r"[a-f0-9]{64}", preflight[key]) for key in ("sourceHash", "planSha256"))
        and matches(r"[A-Za-z0-9_-]{1,128}", preflight["browserBuildId"])
        and set(preflight["containers"]) == SERVICES
        and all(matches(r"[a-f0-9]{64}", identifier) for identifier in preflight["containers"].values()))

    private_path, _ = transaction_paths(root, binding["deploymentId"])
    plan_path = private_path.with_name("foreground-plan.json")
    stage_path = private_path.with_name("foreground-stage.json")
    if restoring:
        require(credential_fd is None)
    else:
        read_credentials(credential_fd)
    try:
        owned = json.loads(read_private(plan_path)[0])
    except FileNotFoundError:
        require(not restoring)
        current, info = read_private(env)
        containers = container_state(inspect(), binding["rollbackReleaseSet"])
        require({key: row["Id"] for key, row in containers.items()} == preflight["containers"])
        model, graph, installed = observe(current)
        previous_runtime, _ = verify_legacy(model, graph, installed, binding["rollbackReleaseSet"])
        require(backend_runtime_url(containers["backend"]) == previous_runtime)
        owned = {"binding": binding, "preflight": preflight, "environment": str(env),
                 "previousSha256": digest(current), "environmentMode": stat.S_IMODE(info.st_mode), "environmentGid": info.st_gid}
        write_private(plan_path, json_bytes(owned))
    require(owned["binding"] == binding and owned["preflight"] == preflight and owned["environment"] == str(env))

    def verify_owned_environment():
        current = read_private(env)[0]
        require_current_environment(env, current, owned)
        try:
            snapshot, previous = load_snapshot(private_path, env, binding)
        except FileNotFoundError:
            require(digest(current) == owned["previousSha256"])
        else:
            require(snapshot["previousSha256"] == owned["previousSha256"]
                    and (current == previous or digest(current) == snapshot["targetSha256"]))

    def run(command, args=(), stdin=None):
        require(context(root, report_dir, coordination_dir, phase) == (session, checkpoint, binding))
        require(verify_boundary(session, checkpoint) is True)
        verify_owned_environment()
        raw = control(command, args, stdin)
        verify_owned_environment()
        require(isinstance(raw, bytes) and 0 < len(raw) <= 16384)
        require(context(root, report_dir, coordination_dir, phase) == (session, checkpoint, binding))
        return raw

    restored = None
    try:
        stage_raw = read_private(stage_path)[0]
    except FileNotFoundError:
        if restoring:
            # If the stage process lost its stdout before any host snapshot,
            # the database's transaction record can prove the prior ACLs.
            require(not os.path.lexists(private_path))
            restored = json.loads(run("restore-predecessor-role-grants"))
            require(set(restored) == {"ok", "roleCutover"} and restored["ok"] is True
                    and restored["roleCutover"]["outcome"] in ("restored", "already-restored"))
            stage_raw = json_bytes({"ok": True, "roleCutover": {**restored["roleCutover"], "outcome": "already-staged"}})
        else:
            stage_raw = run("stage-predecessor-role-grants")
        assert_stage(stage_raw, binding, checkpoint)
        write_private(stage_path, stage_raw)
    stage = assert_stage(stage_raw, binding, checkpoint)

    if restoring:
        restored = restored or json.loads(run("restore-predecessor-role-grants"))
        outcome = restored["roleCutover"]["outcome"]
        require(outcome in ("restored", "already-restored") and restored == {"ok": True, "roleCutover": {**stage, "outcome": outcome}})
        if not os.path.lexists(private_path):
            # Before any config snapshot, the original host transaction cannot
            # have replaced the environment. Prove its exact earlier bytes.
            previous = read_private(env)[0]
            require(digest(previous) == owned["previousSha256"])
            require_current_environment(env, previous, owned)
            model, graph, installed = observe(previous)
            previous_runtime, url = verify_legacy(model, graph, installed, binding["rollbackReleaseSet"])
            snapshot = {
                "binding": binding, "environment": str(env), "stageReceiptSha256": digest(stage_raw),
                "previous": base64.b64encode(previous).decode(), "previousSha256": digest(previous),
                "targetSha256": None, "targetRuntimeSha256": None, "baselineModelSha256": digest(json_bytes(model)),
                "previousRuntimeSha256": digest(previous_runtime.encode()), "previousRuntimeUser": unquote(url.username),
                "environmentMode": owned["environmentMode"], "environmentGid": owned["environmentGid"],
            }
            write_private(private_path, json_bytes(snapshot))
        restore(root, env, report_dir, coordination_dir, observe=observe,
                verify_boundary=lambda actual, point, _: verify_boundary(actual, point))
    else:
        activate_login(root, report_dir, coordination_dir, credential_fd, stage_raw,
                       invoke=lambda frame: json.loads(run("activate-predecessor-runtime-login", stdin=frame)))
        apply(root, env, report_dir, coordination_dir, credential_fd, stage_raw, observe=observe,
              verify_boundary=lambda actual, point, receipt: receipt == stage_raw and verify_boundary(actual, point))

    def attest(expected):
        response = json.loads(run("attest-predecessor-backend-runtime", (expected["backendAddress"], expected["backendId"])))
        require(set(response) == {"ok", "runtimeProof"} and response["ok"] is True)
        return response["runtimeProof"]

    return continue_backend(root, env, report_dir, coordination_dir, preflight["containers"], inspect=inspect,
                            recreate_backend=recreate_backend, verify_boundary=verify_boundary, prove_role=attest)

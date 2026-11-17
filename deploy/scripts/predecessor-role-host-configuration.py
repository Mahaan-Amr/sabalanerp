"""Private host filesystem transaction for the first predecessor role split.

The protected lifecycle owner supplies live observations and owns lease renewal,
database credential activation, service recreation, and all reopening decisions.
Import-only: a caller cannot select this operation from the normal deploy CLI.
"""

import base64
import copy
import fcntl
import hashlib
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


def read_credential(fd):
    require(fd != 9 and os.readlink(f"/proc/self/fd/{fd}").startswith("/memfd:")
            and fcntl.fcntl(fd, fcntl.F_GET_SEALS) & REQUIRED_CREDENTIAL_SEALS == REQUIRED_CREDENTIAL_SEALS)
    password = os.pread(fd, 44, 0)
    require(re.fullmatch(rb"[A-Za-z0-9_-]{43}", password))
    require(base64.urlsafe_b64encode(base64.urlsafe_b64decode(password + b"=")).rstrip(b"=") == password)
    return password


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


def activate_login(root, report_dir, coordination_dir, credential_fd, stage_receipt, *, invoke):
    """Pass a sealed credential to the original protected control command by stdin.

    invoke must run the owned one-off deployment service in the foreground and
    return its parsed redacted result. The frame must never enter argv or env.
    """
    try:
        phase = "MUTATION_STARTED"
        authority = context(root, report_dir, coordination_dir, phase)
        stage = assert_stage(stage_receipt, authority[2], authority[1])
        password = read_credential(credential_fd)
        proof = invoke(stage["stagedAclSha256"].encode("ascii") + password)
        receipt = proof["roleCutover"]
        require(set(proof) == {"ok", "roleCutover"} and proof["ok"] is True and receipt["outcome"] in ("login-activated", "login-already-active")
                and receipt == {**stage, "outcome": receipt["outcome"]})
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
    password = read_credential(credential_fd)
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

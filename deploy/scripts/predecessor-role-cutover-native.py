"""Attach one original child to the owned first-role-cutover lifecycle.

The canonical owner supplies its already-reviewed command and lease renewal.
This module has no shell entry point and grants no release authority.
"""

import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import time
import uuid


SPEC = importlib.util.spec_from_file_location(
    "predecessor_role_host_configuration", Path(__file__).with_name("predecessor-role-host-configuration.py"))
configuration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(configuration)

CONTROL_ACTIONS = {
    "MUTATION_STARTED": {
        "stage-predecessor-role-grants", "activate-predecessor-runtime-login",
        "attest-predecessor-backend-runtime", "recreate-backend",
    },
    "ROLLBACK_STARTED": {"restore-predecessor-role-grants", "attest-predecessor-backend-runtime", "recreate-backend"},
}
CREDENTIAL_ACTION = "activate-predecessor-runtime-login"
MAX_OUTPUT_BYTES = 64 * 1024


class ProtectedNativeChildError(RuntimeError):
    pass


def require(condition):
    if not condition:
        raise ProtectedNativeChildError("PREDECESSOR_ROLE_NATIVE_CHILD_HELD")


def run_native_child(root, report_dir, coordination_dir, phase, action, argv, *, renewal, stdin=None,
                     budget_seconds=180, heartbeat_seconds=60):
    """Return private stdout and a redacted receipt after the original child closes.

    The callback must renew and authenticate the existing protected database lease
    and advisory/maintenance boundary. It must never create a new lease. A failed
    heartbeat or deadline invalidates the result while retaining the child and
    continuing renewal and pipe drainage. FD9 is inherited by the native child.
    """
    try:
        return _run_native_child(root, report_dir, coordination_dir, phase, action, argv, renewal, stdin,
                                 budget_seconds, heartbeat_seconds)
    except Exception:
        raise ProtectedNativeChildError("PREDECESSOR_ROLE_NATIVE_CHILD_HELD") from None


def _run_native_child(root, report_dir, coordination_dir, phase, action, argv, renewal, stdin,
                      budget_seconds, heartbeat_seconds):
    require(action in CONTROL_ACTIONS.get(phase, ())
            and isinstance(argv, (tuple, list)) and 0 < len(argv) <= 256
            and all(isinstance(arg, str) and len(arg) <= 8192 and "\x00" not in arg for arg in argv)
            and 0 < heartbeat_seconds <= budget_seconds <= 900)
    if action == CREDENTIAL_ACTION:
        require(isinstance(stdin, bytes) and re.fullmatch(rb"[a-f0-9]{64}[A-Za-z0-9_-]{43}", stdin))
        password = stdin[64:]
        require(not any(password in os.fsencode(arg) for arg in argv)
                and not any(password in value for value in os.environb.values()))
    else:
        require(stdin is None)

    authority = configuration.context(root, report_dir, coordination_dir, phase)
    session, checkpoint, binding = authority

    def refresh():
        try:
            return (configuration.context(root, report_dir, coordination_dir, phase) == authority
                    and renewal(session, checkpoint) is True
                    and configuration.context(root, report_dir, coordination_dir, phase) == authority)
        except Exception:
            return False

    require(refresh())
    private_path, _ = configuration.transaction_paths(root, binding["deploymentId"])
    attempt_id = uuid.uuid4().hex
    intent_path = private_path.with_name("native-" + attempt_id + "-intent.json")
    result_path = private_path.with_name("native-" + attempt_id + "-result.json")
    identity = {"deploymentId": binding["deploymentId"], "releaseId": binding["releaseId"],
                "checkpointSha256": binding["checkpointSha256"], "checkpointMetadataSha256": binding["checkpointMetadataSha256"],
                "phase": phase, "action": action, "attemptId": attempt_id, "canOpenTraffic": False}
    intent = configuration.json_bytes({"format": "sabalan-predecessor-role-native-intent/v1", **identity})
    configuration.write_private(intent_path, intent)

    interrupted = set()

    def remember(number, _):
        interrupted.add(number)

    managed = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    existing = {number: signal.signal(number, remember) for number in managed}
    started = time.monotonic()
    next_heartbeat = started + heartbeat_seconds
    heartbeat_failed = deadline_exceeded = input_failed = output_overflow = stream_failed = False
    stdout = bytearray()
    closed = {"stdout": False, "stderr": False}
    process = None
    returncode = None
    try:
        if not interrupted:
            try:
                process = subprocess.Popen(
                    argv, cwd=root, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0, pass_fds=(9,), start_new_session=True,
                )
            except OSError:
                pass
        if process is not None:
            if stdin is not None:
                try:
                    require(process.stdin.write(stdin) == len(stdin))
                except (OSError, ProtectedNativeChildError):
                    input_failed = True
                finally:
                    process.stdin.close()
            with selectors.DefaultSelector() as streams:
                for name in closed:
                    streams.register(getattr(process, name), selectors.EVENT_READ, name)
                while process.poll() is None or streams.get_map():
                    now = time.monotonic()
                    deadline_exceeded = deadline_exceeded or now - started >= budget_seconds
                    if now >= next_heartbeat:
                        heartbeat_failed = not refresh() or heartbeat_failed
                        next_heartbeat = time.monotonic() + heartbeat_seconds
                    delay = min(0.05, max(0, next_heartbeat - time.monotonic()))
                    ready = streams.select(delay) if streams.get_map() else ()
                    if not streams.get_map():
                        time.sleep(delay)
                    for key, _ in ready:
                        try:
                            block = os.read(key.fd, 8192)
                        except OSError:
                            stream_failed = True
                            streams.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        if not block:
                            closed[key.data] = True
                            streams.unregister(key.fileobj)
                            key.fileobj.close()
                        elif key.data == "stdout":
                            output_overflow = output_overflow or len(stdout) + len(block) > MAX_OUTPUT_BYTES
                            if not output_overflow:
                                stdout.extend(block)
            returncode = process.wait()
        heartbeat_failed = not refresh() or heartbeat_failed
        deadline_exceeded = deadline_exceeded or time.monotonic() - started >= budget_seconds
        credential_echoed = stdin is not None and stdin[64:] in stdout
        intent_unchanged = configuration.read_private(intent_path)[0] == intent
        healthy = (returncode == 0 and all(closed.values()) and not interrupted and not heartbeat_failed
                   and intent_unchanged
                   and not deadline_exceeded and not input_failed and not output_overflow and not credential_echoed
                   and not stream_failed)
        result = {"format": "sabalan-predecessor-role-native-result/v1", **identity,
                  "outcome": "CLOSED" if healthy else "HELD",
                  "intentSha256": configuration.digest(intent), "intentUnchanged": intent_unchanged,
                  "originalPid": process.pid if process else None, "returnCode": returncode,
                  "childClosed": returncode is not None, "stdoutClosed": closed["stdout"], "stderrClosed": closed["stderr"],
                  "heartbeatFailed": heartbeat_failed, "deadlineExceeded": deadline_exceeded,
                  "inputFailed": input_failed, "outputOverflow": output_overflow, "credentialEchoed": credential_echoed,
                  "streamFailed": stream_failed, "interruptSignals": sorted(interrupted)}
        configuration.write_private(result_path, configuration.json_bytes(result))
        if healthy and interrupted:
            result.update(outcome="HELD", interruptSignals=sorted(interrupted))
            configuration.write_private(result_path, configuration.json_bytes(result))
        require(healthy and not interrupted)
        return bytes(stdout), result
    finally:
        if process is not None and returncode is None:
            # Never return an uncertain native operation to the caller. A
            # local observer error leaves the intent held and waits for exit.
            for pipe in (process.stdin, process.stdout, process.stderr):
                if pipe is not None and not pipe.closed:
                    try:
                        pipe.close()
                    except OSError:
                        pass
            while process.poll() is None:
                if time.monotonic() >= next_heartbeat:
                    refresh()
                    next_heartbeat = time.monotonic() + heartbeat_seconds
                time.sleep(0.05)
            process.wait()
        for number, handler in existing.items():
            signal.signal(number, handler)


def run_native_foreground(root, env, report_dir, coordination_dir, preflight, credential_fd, *, renewal,
                          observe, inspect, control_argv, compose_argv):
    """Bind the existing cutover state machine to the canonical owner's native transports."""
    configuration.verify_lock(root)
    phase = json.loads(
        configuration.read_private(report_dir / "active-deployment-session.json")[0])["phase"]
    configuration.context(root, report_dir, coordination_dir, phase)

    def control(command, args, stdin):
        stdout, _ = run_native_child(root, report_dir, coordination_dir, phase, command, control_argv(command, args),
                                     renewal=renewal, stdin=stdin)
        return stdout

    def recreate(command):
        run_native_child(root, report_dir, coordination_dir, phase, "recreate-backend", compose_argv(command),
                         renewal=renewal, budget_seconds=240)
        return True

    return configuration.foreground(root, env, report_dir, coordination_dir, preflight, credential_fd,
                                    control=control, verify_boundary=renewal, observe=observe, inspect=inspect,
                                    recreate_backend=recreate)
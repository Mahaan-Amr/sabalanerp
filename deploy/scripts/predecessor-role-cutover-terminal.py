"""Durable publication and hold custody for the first predecessor role split.

The dedicated canonical runner supplies the trusted database and ingress
callbacks. Gate evidence on its own grants no public or terminal authority.
"""

import importlib.util
import json
import os
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "predecessor_role_host_configuration", Path(__file__).with_name("predecessor-role-host-configuration.py"))
host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host)
OPEN_INTENT = "predecessor-role-cutover-open-intent.json"
HOLD = "predecessor-role-cutover-active.json"
SESSION = "active-deployment-session.json"
MAINTENANCE = "deployment-maintenance.json"


def owned_plan(root, report_dir, coordination_dir, phase, gate_ack, origins):
    session, checkpoint, binding = host.context(root, report_dir, coordination_dir, phase)
    state, final, mode, gate_count = ("APPLIED", "COMPLETED", "PREDECESSOR_ROLE_APPLIED", 19) if phase == "MUTATION_STARTED" else (
        "RESTORED", "ROLLED_BACK", "PREDECESSOR_ROLE_ROLLBACK", 16)
    host.require(phase in ("MUTATION_STARTED", "ROLLBACK_STARTED")
                 and gate_ack["format"] == "sabalan-predecessor-role-gate-acknowledgement-v1"
                 and gate_ack["state"] == state and gate_ack["canOpenTraffic"] is False
                 and gate_ack["gateMode"] == mode and gate_ack["gateCount"] == gate_count
                 and all(gate_ack[key] == value for key, value in binding.items())
                 and all(host.matches(r"[a-f0-9]{64}", gate_ack[key]) for key in (
                     "gateReportSha256", "roleProofSha256", "nginxProofSha256", "nativeClosureSha256", "backendId", "nginxId"))
                 and len(origins) == 2 and len(set(origins)) == 2
                 and all(host.matches(r"[A-Za-z0-9.-]{1,253}", origin) for origin in origins))
    private, _ = host.transaction_paths(root, binding["deploymentId"])
    gate = host.read_private(private.with_name("role-gates-" + state.lower() + "-acknowledgement.json"))[0]
    host.require(gate == host.json_bytes(gate_ack))
    holds = [root / ".deploy-state" / HOLD, report_dir / HOLD]
    hold_hashes = []
    for path in holds:
        raw = host.read_private(path)[0]
        item = json.loads(raw)
        host.require(all(item[key] == binding[key] for key in ("deploymentId", "releaseId", "checkpointMetadataSha256")))
        hold_hashes.append(host.digest(raw))
    intent = {"format": "sabalan-predecessor-role-public-intent/v1", **binding,
              "state": state, "phase": phase, "expectedTerminal": final,
              "origins": list(origins), "backendId": gate_ack["backendId"], "nginxId": gate_ack["nginxId"],
              "gateAcknowledgementSha256": host.digest(gate), "hostHoldSha256": hold_hashes[0],
              "reportHoldSha256": hold_hashes[1], "trafficMayHaveOpened": True}
    return session, checkpoint, private, intent


def public_evidence(intent):
    return {
        "deploymentId": intent["deploymentId"], "checkpointSha256": intent["checkpointSha256"],
        "backendId": intent["backendId"], "nginxId": intent["nginxId"],
        "gateAcknowledgementSha256": intent["gateAcknowledgementSha256"],
        "origins": {origin: 200 for origin in intent["origins"]},
    }


def assert_open_owner(root, report_dir, coordination_dir, session, intent, path, renew_without_marker):
    host.verify_lock(root)
    host.require(not os.path.lexists(coordination_dir / MAINTENANCE)
                 and json.loads(host.read_private(report_dir / SESSION)[0]) == session
                 and host.read_private(report_dir / OPEN_INTENT)[0] == host.json_bytes(intent)
                 and host.read_private(path)[0] == host.json_bytes(intent)
                 and renew_without_marker(session, intent) is True)


def open_owned_traffic(root, report_dir, coordination_dir, phase, gate_ack, origins, *, authorise, remove_maintenance,
                       renew_without_marker, observe_public, before_intent):
    """Announce the irreversible boundary before the single owned open attempt."""
    host.verify_lock(root)
    remote = report_dir / OPEN_INTENT
    host.require(not os.path.lexists(remote))
    session, checkpoint, private, intent = owned_plan(root, report_dir, coordination_dir, phase, gate_ack, origins)
    local = private.with_name("traffic-open-intent.json")
    # A partially written or uncertain opening is never replayed automatically.
    host.require(not os.path.lexists(local) and not os.path.lexists(remote))
    host.require(authorise(session, checkpoint, gate_ack) is True)
    host.require(owned_plan(root, report_dir, coordination_dir, phase, gate_ack, origins)
                 == (session, checkpoint, private, intent))
    raw = host.json_bytes(intent)
    host.require(before_intent() is True)
    # The backend rollback gate observes the report-directory fence.
    host.write_private(remote, raw)
    host.write_private(local, raw)
    host.require(remove_maintenance(intent.copy()) is True)
    return observe_open_owned_traffic(root, report_dir, coordination_dir, intent["deploymentId"],
                                     renew_without_marker=renew_without_marker, observe_public=observe_public)


def observe_open_owned_traffic(root, report_dir, coordination_dir, deployment_id, *, renew_without_marker, observe_public):
    """Recover a lost opening result by readback, without reopening or replaying."""
    host.verify_lock(root)
    host.require(host.matches(r"[A-Za-z0-9_-]{1,160}", deployment_id))
    private, _ = host.transaction_paths(root, deployment_id)
    local = private.with_name("traffic-open-intent.json")
    raw = host.read_private(local)[0]
    intent = json.loads(raw)
    session = json.loads(host.read_private(report_dir / SESSION)[0])
    host.require(intent["format"] == "sabalan-predecessor-role-public-intent/v1"
                 and intent["trafficMayHaveOpened"] is True and intent["deploymentId"] == deployment_id
                 and session["purpose"] == "predecessor-role-cutover"
                 and all(session[key] == intent[key] for key in (
                     "deploymentId", "releaseId", "targetCommit", "phase", "rollbackReleaseSet")))
    assert_open_owner(root, report_dir, coordination_dir, session, intent, local, renew_without_marker)
    expected = public_evidence(intent)
    host.require(observe_public(expected.copy()) == expected)
    assert_open_owner(root, report_dir, coordination_dir, session, intent, local, renew_without_marker)
    proof = {"format": "sabalan-predecessor-role-public-readback/v1", **expected,
             "intentSha256": host.digest(raw), "expectedTerminal": intent["expectedTerminal"]}
    host.write_private(private.with_name("traffic-open-readback.json"), host.json_bytes(proof))
    return proof


def archive_exact(source, archive, expected):
    if os.path.lexists(archive):
        host.require(not os.path.lexists(source) and host.digest(host.read_private(archive)[0]) == expected)
        return
    host.require(host.digest(host.read_private(source)[0]) == expected)
    os.rename(source, archive)
    host.sync_directory(source.parent)


def archive_terminal_holds(root, report_dir, coordination_dir, deployment_id, *, read_terminal, observe_public):
    """Release custody only after terminal DB and fresh two-origin readback."""
    host.verify_lock(root)
    host.require(host.matches(r"[A-Za-z0-9_-]{1,160}", deployment_id)
                 and not os.path.lexists(report_dir / SESSION) and not os.path.lexists(coordination_dir / MAINTENANCE))
    private, _ = host.transaction_paths(root, deployment_id)
    raw = host.read_private(private.with_name("traffic-open-intent.json"))[0]
    intent = json.loads(raw)
    traffic_raw = host.read_private(private.with_name("traffic-open-readback.json"))[0]
    live = public_evidence(intent)
    host.require(intent["format"] == "sabalan-predecessor-role-public-intent/v1" and intent["deploymentId"] == deployment_id
                 and intent["trafficMayHaveOpened"] is True
                 and json.loads(traffic_raw) == {"format": "sabalan-predecessor-role-public-readback/v1", **live,
                                                "intentSha256": host.digest(raw), "expectedTerminal": intent["expectedTerminal"]})
    terminal = {"deploymentId": deployment_id, "releaseId": intent["releaseId"],
                "targetCommit": intent["targetCommit"], "checkpointSha256": intent["checkpointSha256"],
                "gateAcknowledgementSha256": intent["gateAcknowledgementSha256"],
                "phase": intent["expectedTerminal"], "activeLeases": 0}
    host.require(terminal["phase"] in ("COMPLETED", "ROLLED_BACK")
                 and read_terminal(terminal.copy()) == terminal and observe_public(live.copy()) == live)
    host.verify_lock(root)
    host.require(not os.path.lexists(report_dir / SESSION) and not os.path.lexists(coordination_dir / MAINTENANCE))
    result = {"format": "sabalan-predecessor-role-terminal/v1", **terminal,
              "trafficOpenReadbackSha256": host.digest(traffic_raw), "openIntentSha256": host.digest(raw)}
    host.write_private(private.with_name("terminal-confirmation.json"), host.json_bytes(result))
    for directory, field in ((root / ".deploy-state", "hostHoldSha256"), (report_dir, "reportHoldSha256")):
        archive_exact(directory / HOLD, directory / ("predecessor-role-cutover-" + deployment_id + ".completed.json"), intent[field])
    archive_exact(report_dir / OPEN_INTENT, report_dir / ("predecessor-role-open-" + deployment_id + ".completed.json"), host.digest(raw))
    return result

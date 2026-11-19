"""QA-only recovery proof with a retained, nonblocking advisory session."""

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import select
import subprocess
import sys
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
def recovery_advisory(deployment_id):
    operation_hash = hashlib.sha256(deployment_id.encode()).hexdigest()[:16]
    name = "sabalan-qa-recovery-" + operation_hash + "-" + uuid.uuid4().hex[:16]
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
        yield postgres_pid
    finally:
        command.stdin.close()
        require(command.wait(timeout=10) == 0)
    require(query("SELECT count(*) FROM pg_locks"
                  f" WHERE locktype='advisory' AND classid=0 AND objid={ADVISORY_KEY} AND objsubid=1"
                  f" AND pid={postgres_pid}") == "0")


def prove_owner(plan, digest, environment):
    """Prove that the exact held QA operation can obtain an exclusive holder."""
    proof = json.loads(subprocess.check_output(
        ["node", str(DIRECTORY / "qa-interrupted-role-proof.mjs"), plan, digest, environment],
        encoding="utf8", timeout=60, stderr=subprocess.DEVNULL, pass_fds=(9,)))
    require(proof["format"] == "sabalan-qa-interrupted-role-evidence/v1")
    with recovery_advisory(proof["deploymentId"]):
        pass
    return {**proof, "advisoryOwnershipProven": True, "advisoryReleased": True}


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 5 and sys.argv[1] == "--check-owner-lock")
        print(json.dumps(prove_owner(*sys.argv[2:])))
    except (AssertionError, EOFError, KeyError, OSError, RuntimeError, ValueError, subprocess.SubprocessError):
        print("QA_INTERRUPTED_ROLE_OWNER_UNPROVEN", file=sys.stderr)
        sys.exit(1)

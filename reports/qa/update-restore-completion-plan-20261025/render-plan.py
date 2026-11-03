"""Render local draft tickets and prompts only; no tracker/runtime operations."""
import pathlib
import json

p = pathlib.Path(__file__).resolve().parent
rows = json.loads((p / 'ticket-data.json').read_text(encoding='utf-8'))
rows += json.loads((p / 'ticket-data-rest.json').read_text(encoding='utf-8'))
assert len(rows) == 16
# Reviewed dependency corrections: source freeze precedes the persistent process.
rows[9][3] = [4, 5, 6, 7, 9, 12]
rows[1][6][-1] = rows[1][6][-1].replace('present restored data', 'absent, foreign or unverified restored data')
extras = {
 5: ['Deliver selection/renderer readiness independently; final binding and packaging occur only after source09/12 and accepted migration/browser fixes are integrated. Ticket10 must reject a pack that predates this exact source freeze.'],
 6: ['Deliver a finite migration/user matrix: owned expand/backfill retry, interrupted activation, password verification, effective grant/revocation, disaster revocation versus compatible sessions, and immutable business/audit values. Map every row to existing test/fixture, expected evidence and source-ready versus integrated-runtime status; actual restored-data proof belongs10/14.'],
 7: ['Deliver a finite matrix for retirement clock boundaries, assets/RSC/actions/API, scoped drafts/reauth/cache, lost-response retry, fenced workers/UNKNOWN, and representative domain catalog paths. Map each to an existing test/fixture, expected evidence and source-ready versus integrated-runtime status; do not require ticket10 authority to finish this source ticket.'],
 8: ['Source/lifecycle and retained native-primitive fault proofs close this ticket without asserting a current SourceA coherent physical point. Actual current coherent replay and application certification belong13.'],
 10: ['Source12 must be integrated and frozen before spawning the retained master. This is source readiness only: initial bootstrap requires no physical runtime proof. Final package binding follows that freeze.'],
 12: ['Produce a distinct original same-Compose physical completion consumer. Preserve actual replay-host and independent-RSA-host identities separately; never synthesize the obsolete SSH/backup-host envelope. Source integration finishes before ticket10 starts its retained process.'],
 13: ['This milestone may retain an acquired/qualified following cycle for14. Record pending obligations and original owner identity without serializing capabilities. Reporting must not close, replace or transfer the retained master. Obtain two eligible points within genuine supported cycles; never invent a no-op release.'],
 14: ['Before scheduling native promotion, identify a real accepted next compatible source/candidate distinct from the bootstrap release. This input is currently unresolved; do not manufacture a feature or treat bootstrap as the next update.', 'Continue the exact acquired cycle and live master from13; a new session or report cannot adopt private handles.'],
 15: ['Bind terminal coverage/readback to the last acknowledged post-promotion and post-rollback transaction/file cut and the actual serving rollback release/epoch, separately from the attempted release. Intentionally retained healthy production owners remain; finite guardians/producers/clients must close.']
}
for n, values in extras.items():
    rows[n-1][6].extend(values)
data = []
for n, slug, title, blocks, deliver, lane, criteria in rows:
    refs = '\n'.join('- Draft ticket ' + str(i).zfill(2) + ': ' + rows[i-1][2] for i in blocks) if blocks else 'None (can start immediately).'
    body = f'# {n:02d}: {title}\n\nPublication status: DRAFT pending breakdown confirmation. Intended label: ready-for-agent.\n\n## Parent\n\nhttps://github.com/Mahaan-Amr/sabalanerp/issues/405\n\n## What to build\n\n{deliver}\n\n## Acceptance criteria\n\n'
    body += ''.join('- [ ] ' + x + '\n' for x in criteria)
    body += f'\n## Blocked by\n\n{refs}\n\n## Execution ownership\n\n{lane}\n\n## Readiness boundary\n\nTickets01-09 and12 deliver bounded source behavior and acceptance-port/component readiness, not global native admission. Their tests may reserve coordinator runtime windows, but need no future ticket10 token to become source-ready. Ticket05 final packaging follows source integration, including09/12. Source12 precedes starting10; physical execution follows11. Tickets10-11 and13-15 are serialized native milestones of one persistent coordinator and original process chain. Functional blocking edges do not grant concurrent access to shared resources.\n\n## Handoff contract\n\nUse the supplied completion checkpoint, source map and parallel ownership plan. Preserve successful content and negative parents. Report exact commits, input/output receipts, tests and required natural original closure; distinguish source readiness from runtime qualification. Intermediate native milestone reporting must retain the same live master and outstanding cycle until authorized terminal closure15. No push, second Compose stack or old-checkpoint admission. Do not modify the existing parent.\n'
    file = f'{n:02d}-{slug}.md'
    (p / 'tickets' / file).write_text(body, encoding='utf-8')
    data.append(dict(id=n, title=title, blockedBy=blocks, file=file, deliverable=deliver, lane=lane, publicationStatus='draft', githubIssue=None))
    prompt = f'''Execute completion ticket {n:02d} after its published dependencies are complete.

First read this packet's README.md, CHECKPOINT.json, EVIDENCE.json, SOURCE-MAP.md and tickets/{file}. The packet is at {p}.

Implementation has been paused. This is a new scoped assignment, not permission to resume every historical command. Follow current AGENTS.md, accepted deployment/recovery ADRs and the runbook. Use the actual implementation repository from CHECKPOINT.json, never confuse it with the main checkout. Preserve the staged patch, tracked bytecode, stash and all unrelated files. Never stage or commit the entire dirty worktree.

{lane}

For source tickets: use a dedicated worktree/branch from the integration baseline chosen by the coordinator, check the source map for owned files and leave shared runtime/credentials untouched. Propose narrow changes with behavioral tests and exact source receipts. Do not create another runtime or rebuild unchanged artifacts.

For native milestones: only the designated persistent coordinator may execute them; a fresh session must not reconstruct live master/server tokens from reports. Request the coordinator to consume your source result. All native operations use the existing project and resource lease.

Before work, verify dependency outputs and source freshness. If an input is missing, state the exact missing fact; do not replay used transfers or launch the whole pipeline speculatively. Stop after the assigned ticket's observable acceptance, with a short Persian report, exact commit/receipt/test references, remaining held originals and next dependency. No push. No secrets in chat, logs, tickets or checkpoint files.
'''
    (p / 'prompts' / file).write_text(prompt, encoding='utf-8')
(p / 'TICKETS.json').write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
print(json.dumps(dict(tickets=len(data), initialSourceFrontier=[x['id'] for x in data if not x['blockedBy']])))

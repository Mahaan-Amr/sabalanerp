"""Refresh local navigation after verified publication, without Git mutations."""
import json
import pathlib

p = pathlib.Path(__file__).resolve().parent
state = json.loads((p / 'PUBLICATION.json').read_text(encoding='utf-8'))
assert state['status'] == 'published-and-readback-verified'
rows = json.loads((p / 'TICKETS.json').read_text(encoding='utf-8'))
assert len(rows) == 16 and all(x['publicationStatus'] == 'published' for x in rows)
lines = ['# Published update/restore execution packet', '', 'Approved spec: ' + state['spec']['url'], '', 'All 16 issues include their full ready-to-copy fresh-session prompt and ready-for-agent label. All 17 blocking edges were verified through GitHub native dependencies. Parent405 was not modified; no push or runtime execution.', '', '| Packet | GitHub | Blocked by GitHub issues |', '|---|---|---|']
for x in rows:
    refs = ', '.join('#' + str(state['tickets'][str(b)]['number']) for b in x['blockedBy']) or 'None'
    lines.append(f"|{x['id']:02d}|[#{x['githubIssue']}: {x['title']}]({x['githubUrl']})|{refs}|")
lines += ['', '## First parallel wave', '', 'Start separate source sessions for #409, #410, #411 and #412. Copy the Ready-to-copy fresh-session prompt from each issue. #412 native crypto/SSH must wait for its coordinator resource window; source review proceeds independently.', '', 'When a slot frees, assign #413/#414/#415/#416 according to source ownership. Coordinator must first provide a bounded accepted source baseline including the intended uncommitted work. A HEAD-only checkout is insufficient. No session may share-write the original dirty worktree.', '', 'After #409/#410/#411, integrate #417; after #416/#417, integrate #418. Freeze callback source before starting #419. Native #419 → #420 → #421 → #422 → #423 must preserve one original live master/owner. #424 is final read-only audit. The genuine post-bootstrap candidate required by #422 remains an explicit unresolved input.', '', '## Provenance', '', 'PUBLICATION.json records actual GitHub IDs, URLs, verification status and timestamp. published/ stores the exact submitted bodies. tickets/ and SPEC.md retain the approved draft templates; this file and GitHub are the publication index. CHECKPOINT remains the historical operational stop state, not fresh runtime admission.', '']
(p / 'PUBLISHED.md').write_text('\n'.join(lines), encoding='utf-8')
readme = p / 'README.md'
text = readme.read_text(encoding='utf-8')
banner = '# انتشار تأییدشده در GitHub\n\nSpec: ' + state['spec']['url'] + '\n\n۱۶ تیکت با prompt نشست تازه و وابستگی native منتشر و بازخوانی شدند. فهرست قطعی در `PUBLISHED.md` و جزئیات تأیید در `PUBLICATION.json` است. هیچ push یا اجرای عملیاتی انجام نشده است. متن زیر checkpoint برنامه‌ریزی پیش از انتشار را حفظ می‌کند.\n\n---\n\n'
if not text.startswith('# انتشار تأییدشده'):
    readme.write_text(banner + text, encoding='utf-8')
print(json.dumps({'publishedTickets': len(rows), 'nativeDependencyEdges': sum(len(x['blockedBy']) for x in rows), 'spec': state['spec']['url']}))

"""Offline historical-file analysis only; no runtime, Docker, SSH or process control."""
import datetime
import hashlib
import json
import pathlib
import tarfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
QA = pathlib.Path('D:/sabalanerp-online-qa')


def reference(file):
    raw = file.read_bytes()
    return dict(file=str(file), sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


archive = QA / 'C16-finite-negative-recovery-actual-r3-20261024/old-operation.tar'
archive_before = archive.stat()
catalog = []
with tarfile.open(archive, 'r:') as stream:
    for member in stream:
        if not member.name.endswith('/resources.jsonl'):
            continue
        assert member.isfile() and member.size < 8 * 1024**2
        raw = stream.extractfile(member).read()
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        samples = [dict(phase=row.get('phase'), currentBytes=int(row['cgroup']['memory.current']),
                        maximumBytes=int(row['cgroup']['memory.max']),
                        originalFamilyCount=len(row.get('originalFamily', [])))
                   for row in rows if 'memory.current' in row.get('cgroup', {})]
        assert samples
        peak = max(samples, key=lambda row: row['currentBytes'])
        catalog.append(dict(member=member.name, resourceSha256=hashlib.sha256(raw).hexdigest(),
                            rows=len(rows), first=samples[0], sampledPeak=peak,
                            increaseFromFirstBytes=peak['currentBytes'] - samples[0]['currentBytes'],
                            windowsAvailableNotMeasured=True, fullRunRemainsNegative=True,
                            firstSampleAlreadyActive=True, continuousPeakUnknown=True))
archive_after = archive.stat()
assert (archive_before.st_size, archive_before.st_mtime_ns) == (archive_after.st_size, archive_after.st_mtime_ns)

jobs = []
for stage in ['before-jobs', 'after-jobs-handle-return']:
    file = QA / ('C29-live-catalog-readonly-diagnostic-r1-20261024/main-resources-' + stage + '.json')
    value = read(file)
    jobs.append(dict(stage=stage, reference=reference(file), observedAt=value['observedAt'],
                     currentBytes=int(value['cgroup']['memory.current']),
                     maximumBytes=int(value['cgroup']['memory.max'])))

positive_file = pathlib.Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/reports/qa/application-native-candidate-752f28ed9065cb0e36bacdc5742a71b7.json')
positive = read(positive_file)
profile = positive['candidateQaMemoryPostUpRecovery']
assert positive['pass'] is True and positive['phase'] == 'COMPLETE'
assert reference(positive_file)['sha256'] == 'c7c11717bc55336115a5e8848580dbcda39879e6532ab6d361a3479d76d19c8a'

sources = ['scripts/lib/application-native-qa-memory.mjs',
           'scripts/replace-qualified-application-native-candidate-local.mjs',
           'scripts/lib/original-candidate-rollback-owner.mjs',
           'deploy/scripts/original-native-c3-master-supervisor.py',
           'scripts/lib/original-retained-browser-qualification.mjs',
           'scripts/lib/application-native-prepared-memory.mjs',
           'scripts/lib/original-complete-runtime-plan.mjs',
           'scripts/lib/original-existing-compose-complete.mjs',
           'tests/online-deployment/application-native.fixture.py',
           'tests/online-deployment/application-native-candidate-controller.fixture.py',
           'docs/operations/zero-data-loss-deployment.md',
           'docs/adr/0039-require-verified-zero-data-loss-deployments.md',
           'docs/adr/0131-compatible-online-deployment-and-independent-recovery.md']
report = dict(format='sabalan-419-ram-floor-provenance-offline-evidence/v1',
              recordedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              runtimeActions=0, gateChanges=False, historicalEvidenceIsNotCurrentAdmission=True,
              catalogArchive=dict(file=str(archive), bytes=archive_before.st_size,
                                  archiveHashNotRecomputed=True, extractedTelemetry=catalog),
              retainedJobsSnapshots=jobs,
              retainedJobsSnapshotDeltaBytes=jobs[1]['currentBytes'] - jobs[0]['currentBytes'],
              historicalReplacement=dict(reference=reference(positive_file),
                  replacementPass=True, whole419Acceptance=False,
                  beforeUp=profile['beforeUp'], afterUp=profile['afterUp'],
                  availableDeltaBytes=profile['afterUp']['availableBytes'] - profile['beforeUp']['availableBytes'],
                  peakBetweenSamplesUnknown=True),
              sourceReferences=[reference(ROOT / name) for name in sources],
              existingCgroupAudit=reference(HERE / 'RAM-CGROUP-CENSUS-20261028.json'),
              existingFrontendAssessment=reference(HERE / 'FRONTEND-SUSPENSION-ASSESSMENT-20261029.json'))
output = HERE / 'RAM-FLOOR-PROVENANCE-20261029.json'
with output.open('x', encoding='utf-8', newline='\n') as handle:
    json.dump(report, handle, indent=2)
    handle.write('\n')
print(json.dumps(dict(output=str(output), sha256=reference(output)['sha256'],
                     catalog=catalog, retainedJobsSnapshotDeltaBytes=report['retainedJobsSnapshotDeltaBytes'])))

"""Reuse the reviewed private credential/finite SSH chain with a metadata-only payload."""
import hashlib
import pathlib

root = pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026')
remote = root/'backup-storage-deep-remote.py'
digest = hashlib.sha256(remote.read_bytes()).hexdigest()
source = (root/'inspect-backup-filesystem-r2.py').read_text(encoding='utf-8')
source = source.replace('capacity-filesystem-inventory-remote-r2.py','backup-storage-deep-remote.py').replace('12d0180a26f8c5214de0f522f4162a192b2a14453f6fa1bfa8e49cb36819cd16',digest)
source = source.replace("assert observed['format']=='sabalan-419-readonly-filesystem-inventory/v1'", "assert observed['format']=='sabalan-backup-deep-storage-readonly/v1'")
start = source.index("    snapshot=observed['protectionSnapshot']")
end = source.index('    print(json.dumps',start)
source = source[:start] + "    summary={'format':observed['format'],'volumeCount':len(observed['volumes']),'availableBytesAfter':observed['availableBytesAfter'],'cleanupPerformed':False}\n" + source[end:]
dest = root/'inspect-backup-storage-deep.py'
assert not dest.exists()
dest.write_text(source,encoding='utf-8')
outer = (root/'inspect-backup-filesystem-r2.mjs').read_text(encoding='utf-8')
outer = outer.replace('inspect-backup-filesystem-r2.py','inspect-backup-storage-deep.py').replace('BACKUP-FILESYSTEM-','BACKUP-DEEP-').replace('sabalan-419-backup-filesystem-observation/v1','sabalan-backup-deep-observation/v1')
target = root/'inspect-backup-storage-deep.mjs'
assert not target.exists()
target.write_text(outer,encoding='utf-8')
print('Prepared bounded read-only deep audit; no remote action performed.')

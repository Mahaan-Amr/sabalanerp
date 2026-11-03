import hashlib,pathlib,sys
root=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026')
remote_name=sys.argv[1];stem=sys.argv[2];fmt=sys.argv[3]
assert pathlib.Path(remote_name).name==remote_name and remote_name.endswith('.py')
remote=root/remote_name;digest=hashlib.sha256(remote.read_bytes()).hexdigest()
source=(root/'inspect-backup-filesystem-r2.py').read_text(encoding='utf-8')
source=source.replace('capacity-filesystem-inventory-remote-r2.py',remote_name).replace('12d0180a26f8c5214de0f522f4162a192b2a14453f6fa1bfa8e49cb36819cd16',digest)
source=source.replace("assert observed['format']=='sabalan-419-readonly-filesystem-inventory/v1'",f"assert observed['format']=='{fmt}'")
start=source.index("    snapshot=observed['protectionSnapshot']");end=source.index('    print(json.dumps',start)
source=source[:start]+"    summary={key:observed.get(key) for key in ['format','cleanupPerformed','availableBytes','availableBytesAfter']}\n"+source[end:]
python=stem+'.py';node=stem+'.mjs'
assert not (root/python).exists() and not (root/node).exists()
(root/python).write_text(source,encoding='utf-8')
outer=(root/'inspect-backup-filesystem-r2.mjs').read_text(encoding='utf-8').replace('inspect-backup-filesystem-r2.py',python).replace('BACKUP-FILESYSTEM-',stem.upper()+'-')
(root/node).write_text(outer,encoding='utf-8')
print(node)

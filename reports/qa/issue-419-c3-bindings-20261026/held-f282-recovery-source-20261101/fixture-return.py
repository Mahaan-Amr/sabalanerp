"""Explicit fixture configuration return; protected data is never written."""
import json,os,sys
from pathlib import Path
p=Path(sys.argv[1]);mode=(p/'return-mode').read_text();operation=p.name;stage=sys.argv[2]if len(sys.argv)>2 else'after'
if mode=='fail-before':raise SystemExit(1)
(p/'configuration').write_text('partial'if mode=='partial'else('inquiry'if stage=='after-inquiry'else'baseline'))
if mode=='partial':raise SystemExit(1)
if stage=='after-inquiry'and(p/'lease-loss-before-second').exists():
 (p/'fixture-lease-close').touch()
 import time
 time.sleep(.25)
print(json.dumps({'format':'sabalan-owned-canonical-config-return/v1','operation':operation,'complete':True,'allOriginalChildrenClosed':True,'databaseCopied':False,'exactPredecessorModelsVerified':True,'originalSqliteUnchanged':True}))

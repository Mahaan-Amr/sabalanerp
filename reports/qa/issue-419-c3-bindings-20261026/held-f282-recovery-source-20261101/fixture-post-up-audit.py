"""Read-only fixture audit. Never executes configuration return."""
from pathlib import Path
import hashlib,json,sys,time
p=Path(sys.argv[1]);data=(p/'resource').read_bytes();configuration=(p/'configuration').read_text();expected=b'protected fixture original data\n';safe=data==expected and configuration in ('candidate','inquiry','baseline')
if configuration=='baseline'and(p/'audit-after-fail').exists():safe=False
if(p/'extra-after-audit').exists():
 (p/'native-extra').touch();deadline=time.monotonic()+5
 while not(p/'extra-ready.json').exists():assert time.monotonic()<deadline;time.sleep(.02)
if(p/'mutate-plan-after-audit').exists():
 with(p/'plan.json').open('ab')as f:f.write(b' ')
if(p/'mutate-controller-after-audit').exists():
 with(p/'return-copy.py').open('ab')as f:f.write(b'\n# changed after initial check\n')
if(p/'new-thread-after-audit').exists():
 (p/'spawn-extra-worker').touch();deadline=time.monotonic()+5
 while not(p/'extra-worker-ready').exists():assert time.monotonic()<deadline;time.sleep(.02)
print(json.dumps({'safe':safe,'allOriginalChildrenClosed':True,'conservation':{'dataSha256':hashlib.sha256(data).hexdigest()},'canonicalReturnVerified':configuration=='baseline','stage':{'candidate':'before','inquiry':'after-inquiry','baseline':'after'}.get(configuration,'unknown')}))
raise SystemExit(0 if safe else 1)

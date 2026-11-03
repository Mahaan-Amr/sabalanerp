import subprocess, json, re, collections
def logs(container):
    result=subprocess.run(['docker','logs','--since','6h','--tail','6000',container], capture_output=True,text=True)
    return result.stdout+'\n'+result.stderr
backend=logs('sabalanerp-backend-1')
error_counts={key:len(re.findall(re.escape(key),backend)) for key in ['INTEGRITY_CONFLICT','P2024','P2028','P2034','Accounting dashboard error','Accounting contracts error','heap out of memory']}
nginx=logs('sabalanerp-nginx-1')
rows=[]
for line in nginx.splitlines():
    match=re.search(r'\[([^\]]+)\] "GET (/api/accounting/(?:contracts|dashboard|financial-trend|workspace)(?:\?[^ ]*)?) HTTP/[^ ]+" (\d+)',line)
    if match:
        stamp,path,status=match.groups()
        rows.append({'time':stamp,'route':path.split('?')[0],'hasSearch':bool(re.search(r'[?&]search=',path)),'status':int(status)})
signals=[]
lines=backend.splitlines()
for i,line in enumerate(lines):
    if re.search(r'Accounting (?:contracts|dashboard) error',line,re.I):
        block='\n'.join(lines[i:i+26])
        signals.append({'kind':'dashboard' if 'dashboard' in line.lower() else 'contracts',
          'codes':sorted(set(re.findall(r'P20\d\d|INTEGRITY_CONFLICT|40P01|40001|TRANSACTION[^\s,\x27]+',block))),
          'timeout':bool(re.search(r'timeout|timed out|expired|Transaction already closed',block,re.I)),
          'stack':re.findall(r'at [^\n]*\(/app/dist/[^\n]+',block)[:5]})
print(json.dumps({'note':'Bounded last 6000 log lines per container in preceding 6h; query text, identities and payloads omitted.', 'backendErrorMentions':error_counts,'errorSignals':signals[-10:],'accountingRequests':rows[-65:]}))

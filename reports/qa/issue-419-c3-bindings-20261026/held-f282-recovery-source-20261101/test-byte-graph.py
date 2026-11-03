from pathlib import Path
import hashlib,json,types,uuid,sys
P=Path('D:/sabalanerp-online-qa/held-f282-recovery-20261101');r=types.ModuleType('R');r.__file__=str(P/'recovery-control.py');exec(compile((P/'recovery-control.py').read_bytes(),r.__file__,'exec'),r.__dict__)
d=P/('byte-fixture-'+uuid.uuid4().hex);d.mkdir();files={
'entry.mjs':"import x from './value.json' with{type:'json'};import c from './common.cjs';const d=await import('./dynamic.mjs');console.log(JSON.stringify({safe:x.value===7&&c===9&&d.value===11&&import.meta.url.endsWith('/entry.mjs'),allOriginalChildrenClosed:true}));",
'value.json':'{"value":7}', 'common.cjs':"module.exports=9;",'dynamic.mjs':'export const value=11;'}
for name,raw in files.items():(d/name).write_text(raw,encoding='utf-8')
program={'runtime':'node-graph','executable':'C:/Program Files/nodejs/node.exe','source':r.ref(P/'byte-graph-loader.mjs'),'entry':str(d/'entry.mjs'),'arguments':[],'modules':[r.ref(d/name)for name in files]}
result,receipt=r.finite_verified(program);assert result['safe'];r.durable(d/'success.json',{'result':result,'original':receipt})
# Identity refusal uses exactly the normal input-check path before creating child.
bad=json.loads(json.dumps(program));bad['modules'][0]['sha256']='0'*64
try:r.finite_verified(bad);raise RuntimeError('BAD_IDENTITY_ACCEPTED')
except AssertionError:pass
# A genuinely ended original child with module-level throw stays negative with EOF.
(d/'dynamic.mjs').write_text("throw Error('fixture-refusal');",encoding='utf-8');program['modules']=[r.ref(d/name)for name in files]
try:r.finite_verified(program);raise RuntimeError('CHILD_FAILURE_ACCEPTED')
except r.core.AuditFailure as error:assert error.receipt['code']!=0 and error.receipt['stdoutEof']and error.receipt['stderrEof'];r.durable(d/'negative.json',error.receipt)
print(json.dumps({'fixture':str(d),'realNode':True,'dynamicAndCjsAndJson':True,'wrongIdentityRejected':True,'childFailureDrained':True,'nativeTargeted':False}))

"""Derive the reviewed finite collector for invocation inside the image owner.

No standalone runtime entry point. The containing original owns parent custody
and keeps the same query handles alive across every actual child and EOF.
"""
import json
import pathlib
import runpy

HERE = pathlib.Path(__file__).resolve().parent


def build(binding, source):
    review = json.loads(source['pinned'](source['REVIEW'] / 'source-review.json', source['REVIEW_SHA']))
    row = review['files']['windows-owner.template.py']
    text = source['pinned'](row['file'], row['sha256']).decode()
    replace = source['replace_once']
    assert binding['service'] == 'backend' and binding['component'] == source['component']()
    text = replace(text, 'BOUND=None', 'BOUND=' + repr(binding))
    text = replace(text, "component=module(b['sourceFiles']['components.py'],'fixed_two_components')['select'](b['service']);assert component==b['component']", "component=module(b['sourceFiles']['components.py'],'fixed_c3_backend_content')['component']();assert component==b['component']")
    # Retain all old child/pipe handling. Add the same original parent's custody
    # before each actual spawn and after natural child/readers closure.
    text = replace(text, 'def main():', 'def run(parent_custody):\n parent_custody.assert_current()')
    text = replace(text, "argv=ssh_argv(profile);reused_stream=None", "argv=ssh_argv(profile);reused_stream=None\n original_run=owner.run_original\n def guarded_run(*args,**kwargs):\n  parent_custody.assert_current()\n  try:return original_run(*args,**kwargs)\n  finally:parent_custody.assert_current()\n owner.run_original=guarded_run")
    text = replace(text, "assert __import__('shutil').disk_usage(output).free>=3*staged['imageBytes']+64*1024**2+512*1024**2,'WINDOWS_STREAM_WORKSPACE_REFUSED'", "assert __import__('shutil').disk_usage(output).free>=3*b['component']['raw']['bytes']+64*1024**2+512*1024**2,'WINDOWS_STREAM_WORKSPACE_REFUSED'")
    # The archive/image proof belongs to #413; the serving host remains e407.
    text = replace(text, "assert staged['files']['runtime.py']['sha256']==b['runtimeSourceSha256']", "assert staged['files']['runtime.py']['sha256']==b['runtimeSourceSha256']\n  assert staged['producerImage']==" + repr(source['PRODUCER']) + " and staged['image']==b['component']['image'] and staged['rootfsDiffIds']==b['component']['rootfsDiffIds']")
    text = replace(text, "assert remote['image']==b['component']['image']", "assert remote['producerImage']==" + repr(source['PRODUCER']) + ";assert remote['image']==b['component']['image']")
    # Only new protocol names change. The canonical gzip/OCI validator and
    # unchanged bounded original collector keep their original format names.
    for old in ['sabalan-source-a-stream-source-stage/v1', 'sabalan-source-a-closed-stream-phase/v1',
                'sabalan-source-a-closed-local-hash-phase/v1', 'sabalan-source-a-original-closed-stream-phase/v1',
                'sabalan-source-a-original-closed-local-hash-phase/v1', 'sabalan-source-a-stream-phase-negative/v1']:
        text = text.replace(old, old.replace('sabalan-source-a-', 'sabalan-c3-backend-'))
    text = replace(text, "if __name__=='__main__':print(json.dumps(main()))", '')
    text += '''
def run_capacity(parent_custody):
 parent_custody.assert_current();b=BOUND;assert b['phase']=='capacity-only'
 for ref in b['sourceFiles'].values():read(ref)
 ad=module(b['admission'],'fixed_current_capacity_admission');spec=json.loads(read(b['runtimeSpec']));ad['validate_spec'](spec)
 preflight=module(b['preflightValidator'],'fixed_capacity_preflight');preflight['validate'](b['preflight'])
 profile=json.loads(read(b['profile']));assert profile['format']=='sabalan-fixed-production-original-ssh/v1' and profile['host']=='94.182.85.254' and profile['user']=='root'
 custody=module(b['custody'],'fixed_capacity_custody')
 for name,digestName in [('sshExecutable','sshExecutableSha256'),('privateKeyPath','privateKeySha256'),('knownHostsPath','knownHostsSha256')]:custody['pin'](profile[name],profile[digestName],installed_ssh=name=='sshExecutable')
 acl=module(b['privateOutputProducer'],'fixed_capacity_private_output');output=pathlib.Path(b['output']);private=acl['private_output'](output)
 core={};exec(compile(read(b['sourceFiles']['original.py']),'fixed-capacity-original','exec'),core);owner=core['SourceStreamOwner'](output)
 original_run=owner.run_original
 def guarded_run(*args,**kwargs):
  parent_custody.assert_current()
  try:return original_run(*args,**kwargs)
  finally:parent_custody.assert_current()
 owner.run_original=guarded_run;result=None
 try:
  ssh=module(b['sshOwner'],'fixed_capacity_original_ssh');env=dict(os.environ);env['PSModulePath']='C:/Windows/System32/WindowsPowerShell/v1.0/Modules'
  signature=owner.run_original(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-Command',ssh['SIGNATURE_COMMAND']],'nativeSshSignature',maximum_stdout=2*1024**2,env=env)
  assert signature['stderrBytes']==0 and json.loads(read(signature['stdout']))=={'Status':'Valid','Subject':'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US','Thumbprint':'AD714D3C4B2B794A95441375C954130E9109EF4C'}
  row=pinned_ssh(owner,custody,profile,[*ssh_argv(profile),'python3 -I -B -'],'stageSource',secret_input=read(b['sourceFiles']['stage.py']),maximum_stdout=2*1024**2)
  assert row['stderrBytes']==0 and not owner.interrupted
  value=json.loads(read(row['stdout']));assert value['format']=='sabalan-c3-image-capacity-original/v1' and value['operation']==b['operation'] and value['runtimeSpecSha256']==b['runtimeSpec']['sha256']
  assert value['allOriginalChildrenClosed'] is True and value['sourceWorkspaceCreated'] is False and value['privateKeyRead'] is False and value['productionAdmission'] is False
  assert type(value['capacity']['backupCanonicalReserveBytes']) is int and value['capacity']['backupCanonicalReserveBytes']>0
  result=dict(format='sabalan-c3-image-capacity-windows-original/v1',operation=b['operation'],remote=value,originalClosures=owner.children,allOriginalChildrenClosed=True,productionAdmission=False)
  return core['save'](output/'capacity-complete.json',result)
 finally:
  owner.close()
  if result is None:core['save'](output/'capacity-negative.json',dict(format='sabalan-c3-image-capacity-negative/v1',operation=b['operation'],originalClosures=owner.children,interrupted=owner.interrupted,productionAdmission=False))
'''
    compile(text, 'c3-backend-stream-owned-function', 'exec')
    return text.encode()

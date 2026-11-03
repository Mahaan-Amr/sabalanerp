"""Pure no-delete preflight source. Uses unchanged canonical --mode plan.

No installed wrapper is edited or invoked. Canonical JS buffers are embedded
as data modules; only their existing capacity audit is written on the hosts.
"""
import ast,base64,json,pathlib,re


def original_windows_owner(source):
    captured=source['captured_sources'](source['REVIEW'],source['REVIEW_SHA'])
    raw=source['execute_source'](captured['build-original.py'],source['REVIEW']/'build-original.py','readonly_same_original_source')['build']().decode()
    replace=source['replace_once']
    raw=replace(raw,"('nativeSshSignature','stageSource','binaryPhase','validateArchive')","('nativeSshSignature','sourcePreflight','backupPreflight','credentialIdentity','credentialAcl')")
    raw=replace(raw,"phase in ('backupPrepare','backupReseal','cipherDownload','backupCleanup')","phase=='backupPreflight'")
    raw=replace(raw,'input_file=None,env=None):','input_file=None,env=None,interactive=None):')
    raw=replace(raw,"   with open(out_path,'xb')as out,open(err_path,'xb')as err:","   interaction=None\n   with open(out_path,'xb')as out,open(err_path,'xb')as err:")
    raw=replace(raw,'\n     reader=threading.Thread(target=pump_stderr,daemon=False);reader.start()\n',"\n     reader=threading.Thread(target=pump_stderr,daemon=False);reader.start()\n     if interactive is not None:\n      assert phase=='sourcePreflight' and not secret_input and input_file is None\n      interaction=interactive(child)\n")
    raw=replace(raw,"row={'format':'sabalan-secret-stdin-original-closure/v1'","row={'interaction':interaction,'format':'sabalan-secret-stdin-original-closure/v1'")
    compile(raw,'readonly-same-original-owner','exec')
    return raw.encode()


def canonical_plan_code(canonical,args):
    assert set(canonical)=={'deploy/scripts/storage-preflight.mjs','scripts/deployment-storage.mjs'}
    assert args.count('--mode')==1 and args[args.index('--mode')+1]=='plan'
    assert '--required-bytes' in args
    dependency='data:text/javascript;base64,'+base64.b64encode(canonical['scripts/deployment-storage.mjs']).decode()
    text=canonical['deploy/scripts/storage-preflight.mjs'].decode()
    old="'../../scripts/deployment-storage.mjs'";assert text.count(old)==1
    module='data:text/javascript;base64,'+base64.b64encode(text.replace(old,repr(dependency)).encode()).decode()
    code="import fs from 'node:fs';import{createHash}from'node:crypto';if(process.argv.length!==1)throw Error('READONLY_FIXED_ARGV_REQUIRED');const args="+json.dumps(args,separators=(',',':'))+";const{storagePreflight}=await import("+json.dumps(module)+");const get=k=>args[args.indexOf(k)+1];try{const r=await storagePreflight(args);console.log(JSON.stringify({ok:true,project:get('--project'),mode:'plan',removed:[],requiredBytes:Number(get('--required-bytes')),availableBytes:r.availableBytes,planSha256:createHash('sha256').update(JSON.stringify(r.plan)).digest('hex')}));}catch(e){let availableBytes=null;try{const s=fs.statfsSync(get('--storage-root'));availableBytes=s.bavail*s.bsize;}catch{}console.log(JSON.stringify({ok:false,project:get('--project'),mode:'plan',removed:[],requiredBytes:Number(get('--required-bytes')),availableBytes,code:/^STORAGE_[A-Z_]+(?::--[a-z-]+)?$/.test(e.message)?e.message:'STORAGE_PREFLIGHT_FAILED'}));}"
    assert len(code.encode())<120000
    return code


def build(spec,operation,source,canonical,fragments,configuration,own_source,image_source,readiness_source):
    assert re.fullmatch('[a-f0-9]{32}',operation)
    assert configuration['purpose'] in ['COMPLETE_FULL','IMAGE_STAGING']
    assert set(fragments)=={'source','backup','backupHost','channel'}
    assert type(configuration['cipherBytes']) is int and configuration['cipherBytes']==1242945672
    assert type(configuration['imageCipherUpperBoundBytes']) is int and configuration['imageCipherUpperBoundBytes']>0
    # The initial read-only capacity measurement cannot require a prior
    # capacity PASS. Its unchanged current-baseline/config/FD9 guards remain.
    # This source contains no crypto/export/install entry point.
    parent=source['render_guard_artifacts'](spec,operation,pathlib.Path('D:/sabalanerp-online-qa')/('readonly-source-not-created-'+operation),None)
    raw=parent['remote.py'].decode();base=raw[:raw.index('def observe(h):')]
    tree=ast.parse(base)
    for node in reversed(tree.body):
        if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['INSPECTOR','ENCRYPTOR','CODEC','PREFLIGHT','PUBLIC_PROBE'] for t in node.targets):
            segment=ast.get_source_segment(base,node);base=source['replace_once'](base,segment,'')
    age=" age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(PREFLIGHT['observedAt'].replace('Z','+00:00'))).total_seconds();assert 0<=age<=600 and len(PREFLIGHT['sha256'])==64\n"
    base=source['replace_once'](base,age,'')
    before='validate_current_configuration(rows,SPEC)\n'
    health="validate_current_configuration(rows,SPEC);assert all(r['State']['Running'] and r['State'].get('Health',{}).get('Status')=='healthy' and r['State']['OOMKilled'] is False and r['State']['Dead'] is False and not r['State']['Error'] for r in rows if r['Config']['Labels']['com.docker.compose.service'] in ROLES)\n"
    base=source['replace_once'](base,before,health)
    functions=[n for n in ast.parse(own_source).body if isinstance(n,ast.FunctionDef) and n.name=='canonical_plan_code'];assert len(functions)==1
    common='\nCANONICAL='+repr(canonical)+'\n'+ast.get_source_segment(own_source.decode(),functions[0])+'\n'
    readiness_tree=ast.parse(readiness_source);selected=[]
    for item in readiness_tree.body:
        if isinstance(item,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='RECOVERY_METADATA_PROBE' for target in item.targets):
            assert isinstance(item.value,ast.Constant) and isinstance(item.value.value,str) and 0<len(item.value.value.encode())<=65536;selected.append(ast.get_source_segment(readiness_source.decode(),item))
        elif isinstance(item,ast.FunctionDef) and item.name=='recovery_boundary_clear':selected.append(ast.get_source_segment(readiness_source.decode(),item))
    assert len(selected)==2,'COMPLETE_SOURCE_RECOVERY_DEPENDENCIES_REQUIRED'
    common='import base64\n'+common
    readiness='\n'+'\n'.join(selected)+'\n'
    source_program=(base+common+readiness+'\nSTORAGE_OPERATION='+repr(operation)+'\n'+fragments['source'].decode()+'\nif __name__=="__main__":sys.exit(run_source_preflight())\n').encode()
    captured=source['captured_sources'](source['REVIEW'],source['REVIEW_SHA'])
    independent=source['execute_source'](captured['build-independent.py'],source['REVIEW']/'build-independent.py','readonly_backup_guard_source')
    backup_base=independent['fixed_guards']()
    # Same backup host/Node/OFD owner and bounded exceptional drain as images.
    backup_program=(backup_base+common+'\nSTORAGE_OPERATION='+repr(operation)+'\nSTORAGE_CONFIGURATION='+repr(configuration)+'\nCOLLECTOR_SOURCE='+repr(image_source['original_backup_collector'](source))+'\nCHANNEL_SOURCE='+repr(fragments['channel'].decode())+'\n'+fragments['backupHost'].decode()+'\n'+fragments['backup'].decode()+'\nif __name__=="__main__":sys.exit(run_backup_preflight())\n').encode()
    for code in [source_program,backup_program]:assert len(code)<=2*1024**2;compile(code,'fixed-no-delete-storage-preflight','exec')
    return dict(source=source_program,backup=backup_program,productionAdmission=False)

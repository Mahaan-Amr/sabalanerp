"""Original main's genuine installed-image HTTP owner and paired control flow."""
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlunsplit, quote

OWNER = None
DOMAIN_RESTORE = None
PROVIDER_ENV = dict(NODE_ENV='test', SMS_IR_API_KEY='', SMS_IR_ENVIRONMENT='production',
    SMS_IR_API_URL='http://127.0.0.1:1', WEB_PUSH_VAPID_PUBLIC_KEY='', WEB_PUSH_VAPID_PRIVATE_KEY='',
    WEB_PUSH_VAPID_SUBJECT='', TAXPAYER_DELIVERY_BROKER_ENDPOINT='', HR_HIRING_E2E='false',
    HR_HIRING_SMS_ADAPTER='disabled', HTTP_PROXY='', HTTPS_PROXY='', ALL_PROXY='', http_proxy='',
    https_proxy='', all_proxy='', NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')


def birth(pid):
    process=Path('/proc')/str(pid); fields=(process/'stat').read_text().rsplit(') ',1)[1].split()
    return dict(pid=pid,startTicks=fields[19],bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink(process/'ns/pid'))


def resources():
    root=Path('/sys/fs/cgroup')
    return dict(current=int((root/'memory.current').read_text()),maximum=int((root/'memory.max').read_text()),
                events=dict((key,int(value)) for key,value in (line.split() for line in (root/'memory.events').read_text().splitlines())))


def original_custody_closed():
    if OWNER is None:return True
    return (DOMAIN_RESTORE is None or DOMAIN_RESTORE.original_custody_closed(OWNER['sql'])) and OWNER.get('nativeClosed') is True and (OWNER.get('oldJobs') is None or OWNER['oldJobs'].closed) and all(probe.poll() is not None for probe in OWNER['probes'])


def original_failure_closed():
    return original_custody_closed() and OWNER is not None and OWNER.get('failureClosed') is True


def run(root,index,config,source,sql,history,write,encoded,check,role_client,source_closures,coherent):
    global OWNER,DOMAIN_RESTORE
    check(OWNER is None,'PRIVATE_PAIR_ALREADY_STARTED')
    pair=index['privateQualification']; grant=pair['httpGrant']; app=Path(pair['qualificationRoot'])
    issued=role_client.request('ISSUE_PRIVATE_QUALIFICATION',dict(sourceClosures=source_closures),'PRIVATE_QUALIFICATION_ISSUED')
    check(issued['qualificationId']==pair['qualificationId'] and issued['actualHttpTargets']==2,'PRIVATE_PAIR_ISSUER_CHANGED')
    before=resources();check(before['maximum']==768*1024**2 and before['maximum']-before['current']>=256*1024**2,'PRIVATE_PAIR_HTTP_CAPACITY_REFUSED')
    env=dict(os.environ,**PROVIDER_ENV)
    env.update(DATABASE_URL=urlunsplit(source._replace(path='/'+index['restoredDatabase'],query='connection_limit=2&pool_timeout=10')),
        BACKEND_RUNTIME_ROLE='serving',BACKEND_ONLINE_SCOPE_FILE=grant['file'],BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
        RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],RECOVERY_STORAGE_DIR=str(app/'storage/recovery'),NODE_PATH='/app/node_modules')
    actor_id=__import__('secrets').token_hex(32)
    output=root/'private-qualification-http.stdout'; errors=root/'private-qualification-http.stderr'
    with output.open('xb') as out, errors.open('xb') as err:
        child=subprocess.Popen(['/usr/bin/python3','-I','-B',str(root/'online-runtime-owner.py'),'/usr/local/bin/node',
            str(root/'online-private-qualification-worker.cjs'),config['originalHostEnrollment']['publicKey'],
            config['originalHostEnrollment']['session'],actor_id],cwd=app,env=env,stdin=subprocess.PIPE,stdout=out,stderr=err)
    OWNER=dict(child=child,grant=grant,actorId=actor_id,probes=[],nativeClosed=False,before=before,sql=sql)
    owner_birth=birth(child.pid); OWNER['birth']=owner_birth
    native_file=Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json'
    end=time.monotonic()+120
    while True:
        check(child.poll() is None and time.monotonic()<end,'PRIVATE_PAIR_HTTP_NATIVE_NOT_ACTIVE')
        if native_file.exists():
            raw=native_file.read_bytes();native=json.loads(raw)
            if native.get('phase')=='ACTIVE':break
        time.sleep(0.02)
    check(native['guardian']==owner_birth and native['onlineScope']['sha256']==grant['sha256'],'PRIVATE_PAIR_HTTP_NATIVE_CHANGED')
    role_client.channel.emit('PRIVATE_HTTP_STARTED',dict(actorId=actor_id,scopeSha256=grant['sha256'],
        originalPopenPid=child.pid,birth=owner_birth,activeNativeRawBase64=base64.b64encode(raw).decode()))

    def event(name,seconds=240):
        deadline=time.monotonic()+seconds
        while True:
            check(output.stat().st_size<=2*1024**2,'PRIVATE_PAIR_HTTP_LOG_BOUND')
            records=[]
            for line in output.read_bytes().splitlines():
                if not line.startswith(b'SABALAN_PRIVATE_QUALIFICATION '):continue
                parsed=json.loads(line[len(b'SABALAN_PRIVATE_QUALIFICATION '):])
                if parsed['event']==name:records.append(parsed)
            check(len(records)<=1,'PRIVATE_PAIR_HTTP_DUPLICATE_EVENT')
            if records:
                result=records[0];check(result['actorId']==actor_id and result['scopeSha256']==grant['sha256']
                    and result['session']==config['originalHostEnrollment']['session'],'PRIVATE_PAIR_HTTP_EVENT_CHANGED')
                return result
            check(child.poll() is None and time.monotonic()<deadline,'PRIVATE_PAIR_HTTP_EVENT_UNPROVEN_'+name)
            time.sleep(0.02)

    ready=event('READY',120);identity=ready['identity']
    check(identity['purpose']=='http' and identity['qualificationId']==pair['qualificationId']
        and identity['runtimeId']==grant['scope']['runtimeId'] and identity['image']==config['roleTopology']['main']['image']
        and identity['runtimeBundleSha256']==pair['runtimeBundleSha256']
        and ready['installedEntrySha256']==config['privateQualificationRuntime']['entrySha256'],'PRIVATE_PAIR_HTTP_READY_CHANGED')
    role_client.channel.emit('PRIVATE_HTTP_READY',dict(actorId=actor_id,result=ready))
    http2_grant=pair['httpGrants'][1]
    http2=role_client.request('START_PRIVATE_HTTP2',{},'PRIVATE_HTTP2_READY',http2_grant)
    http2_identity=http2['result']['identity'];http2_ingress=http2_identity['httpIngress']
    check(http2_identity['runtimeId']==http2_grant['scope']['runtimeId'] and http2_identity['image']==config['roleTopology']['candidate']['image']
        and http2_identity['image']!=identity['image'] and http2_ingress['bindHost']==config['roleTopology']['candidate']['host'], 'PRIVATE_PAIR_SECOND_IMAGE_OR_INGRESS_CHANGED')
    jobs_grant=pair['jobsGrant']
    import importlib.util,sys
    old_spec=importlib.util.spec_from_file_location('application_original_private_old_jobs',root/'application-native-private-old-jobs.fixture.py')
    old_module=importlib.util.module_from_spec(old_spec);sys.modules[old_spec.name]=old_module;old_spec.loader.exec_module(old_module)
    old_jobs=old_module.OriginalPrivateOldJobs(root,index,config,role_client,check,env,birth,resources)
    OWNER['oldJobs']=old_jobs;old_jobs.start()
    seed=json.loads((app/'acceptance-seed.json').read_bytes());ingress=identity['httpIngress']
    business_failure=None
    try:
        connection=http.client.HTTPConnection(ingress['bindHost'],ingress['port'],timeout=15)
        try:
            connection.request('GET','/api/health');response=connection.getresponse();check(response.status==200,'PRIVATE_PAIR_GENUINE_HEALTH_FAILED');response.read()
            connection.request('GET','/api/accounting/ledger/customer-accounts/'+quote(seed['customerId'],safe=''),headers={'Cookie':'sabalan_session='+seed['sessionToken']})
            response=connection.getresponse();body=json.loads(response.read());check(response.status==200 and str(body['data']['netBalanceRials'])=='123456800','PRIVATE_PAIR_GENUINE_RESTORED_ACCOUNT_CHANGED')
        finally:connection.close()
        probe_input=dict(root=str(root),qualificationRoot=str(app),qualificationId=pair['qualificationId'],
            host=ingress['bindHost'],port=ingress['port'],database=index['restoredDatabase'],databaseOid=str(index['restoredOid']),
            systemIdentifier=grant['scope']['database']['systemIdentifier'],httpRuntimeId=grant['scope']['runtimeId'],
            jobsRuntimeId=jobs_grant['scope']['runtimeId'],oldJobsRuntimeId=pair['oldJobsGrant']['scope']['runtimeId'],httpTargets=[dict(runtimeId=grant['scope']['runtimeId'],host=ingress['bindHost'],port=ingress['port']),
                dict(runtimeId=http2_grant['scope']['runtimeId'],host=http2_ingress['bindHost'],port=http2_ingress['port'])],seedSha256=hashlib.sha256((app/'acceptance-seed.json').read_bytes()).hexdigest())
        probe_env={key:value for key,value in env.items() if not key.startswith('BACKEND_')}
        probe_env.update(BACKEND_RUNTIME_ROLE='standalone',APPLICATION_NATIVE_BIND_HOST=ingress['bindHost'])
        probe_output=root/'private-pair-original-bridge.stdout';probe_errors=root/'private-pair-original-bridge.stderr'
        with probe_output.open('xb') as out,probe_errors.open('xb') as err:
            probe=subprocess.Popen(['/usr/local/bin/node',str(root/'private-pair-bridge-probe.mjs')],cwd=app,env=probe_env,
                stdin=subprocess.PIPE,stdout=out,stderr=err)
        OWNER['probes'].append(probe);probe.stdin.write(encoded(probe_input)+b'\n');probe.stdin.flush()
        deadline=time.monotonic()+240
        while True:
            check(probe_output.stat().st_size<=2*1024**2 and probe_errors.stat().st_size<=65536,'PRIVATE_PAIR_BRIDGE_LOG_BOUND')
            stages=[json.loads(line[len(b'SABALAN_PRIVATE_BRIDGE_STAGE '):]) for line in probe_output.read_bytes().splitlines() if line.startswith(b'SABALAN_PRIVATE_BRIDGE_STAGE ')]
            check(len(stages)<=1,'PRIVATE_PAIR_BRIDGE_DUPLICATE_HANDOFF')
            if stages:break
            check(probe.poll() is None and time.monotonic()<deadline,'PRIVATE_PAIR_OLD_NOTIFICATION_UNPROVEN');time.sleep(.02)
        check(stages[0]['event']=='PREDECESSOR_NOTIFICATION_SETTLED' and stages[0]['oldJobsRuntimeId']==pair['oldJobsGrant']['scope']['runtimeId'],'PRIVATE_PAIR_OLD_NOTIFICATION_IDENTITY_CHANGED')
        old_job_closure=old_jobs.close(resources)
        # New Popen is created only AFTER the original old guardian/namespace/worker lock closed.
        jobs=role_client.request('START_PRIVATE_JOBS',{},'PRIVATE_JOBS_READY',jobs_grant)
        probe.stdin.write(encoded(dict(command='ORIGINAL_OLD_JOBS_CLOSED_NEW_JOBS_READY',oldJobsRuntimeId=pair['oldJobsGrant']['scope']['runtimeId'],newJobsRuntimeId=jobs_grant['scope']['runtimeId'],oldNativeSha256=hashlib.sha256(base64.b64decode(old_job_closure['nativeRawBase64'])).hexdigest()))+b'\n');probe.stdin.flush();probe.stdin.close()
        probe.wait();probe_out=probe_output.read_bytes();probe_err=probe_errors.read_bytes()
        check(probe.returncode==0 and len(probe_out)<=2*1024**2 and len(probe_err)<=65536,'PRIVATE_PAIR_BRIDGE_PROBE_UNPROVEN')
        records=[json.loads(line) for line in probe_out.splitlines() if line.startswith(b'{')]
        check(len(records)==1,'PRIVATE_PAIR_BRIDGE_RESULT_UNPROVEN');probe_out=json.dumps(records[0]).encode()
        bridge=json.loads(probe_out);check(bridge['format']=='sabalan-private-pair-bridge-qualification/v1' and bridge['passResult'] is True,'PRIVATE_PAIR_BRIDGE_RESULT_UNPROVEN')
        domain=role_client.request('RUN_PRIVATE_DOMAIN_CASES',{},'PRIVATE_DOMAIN_DONE')
    except BaseException as failure:
        if any(probe.poll() is None for probe in OWNER['probes']):raise
        business_failure=failure
    role_client.request('PREPARE_PRIVATE_JOBS',dict(actorId=jobs['actorId']),'PRIVATE_JOBS_PREPARED',actor_id=jobs['actorId'])
    job_closed=role_client.request('FINISH_PRIVATE_JOBS',dict(actorId=jobs['actorId']),'PRIVATE_JOBS_DONE',jobs_grant,actor_id=jobs['actorId'])
    if business_failure is None:
        try:
            private_chrome=role_client.request('START_PRIVATE_CHROME',{},'PRIVATE_CHROME_READY')
            browser_input=dict(root=str(root),config=config,seed=seed,grants=pair['httpGrants'],ready=[identity,http2_identity],
                chromeEnvelope=dict(publicKey=config['originalHostEnrollment']['publicKey'],session=config['originalHostEnrollment']['session'],envelope=role_client.private_chrome_receipt.envelope))
            browser_env={key:value for key,value in env.items() if not key.startswith('BACKEND_')}
            browser_env.update(BACKEND_RUNTIME_ROLE='standalone',DATABASE_URL=urlunsplit(source._replace(path='/'+index['restoredDatabase'],query='connection_limit=2&pool_timeout=10&application_name=qa-installed-browser')))
            browser_output=root/'installed-paired-browser.stdout';browser_errors=root/'installed-paired-browser.stderr'
            with browser_output.open('xb') as out,browser_errors.open('xb') as err:
                browser_child=subprocess.Popen(['/usr/local/bin/node',str(root/'installed-paired-browser.mjs'),config['originalHostEnrollment']['publicKey'],config['originalHostEnrollment']['session']],
                    cwd=app,env=browser_env,stdin=subprocess.PIPE,stdout=out,stderr=err,pass_fds=(20,))
            OWNER['probes'].append(browser_child)
            browser_child.stdin.write(encoded(browser_input));browser_child.stdin.close();browser_child.wait()
            browser_raw=browser_output.read_bytes();browser_err=browser_errors.read_bytes()
            role_client.request('WAIT_PRIVATE_CHROME_CLOSED',dict(actorId=private_chrome['actorId']),'PRIVATE_CHROME_CLOSED',actor_id=private_chrome['actorId'])
            if len(browser_raw)>2*1024**2 or len(browser_err)>65536 or browser_child.returncode!=0:
                business_failure=RuntimeError('PRIVATE_INSTALLED_BROWSER_UNPROVEN')
            else:
                installed_routing=json.loads(browser_raw)
                if installed_routing.get('format')!='sabalan-installed-paired-browser/v1':
                    business_failure=RuntimeError('PRIVATE_INSTALLED_ROUTING_FORMAT_INVALID')
                else:
                    browser_verified=role_client.request('VERIFY_PRIVATE_BROWSER_TICKETS',dict(expectationsSha256=hashlib.sha256(browser_raw).hexdigest()),'PRIVATE_BROWSER_TICKETS_VERIFIED')
        except BaseException as failure:
            refused=getattr(role_client,'failed_closed',None)
            known_observer=bool(refused and refused.get('failedEvent')=='PRIVATE_BROWSER_TICKETS_VERIFIED'
                and refused.get('result',{}).get('originalKnownClosed') is True)
            if not known_observer and (not refused or refused.get('noWorkStarted') is not True or refused.get('kind')!='private-chrome'):raise
            business_failure=failure
    if business_failure is None:
        role_client.request('ROTATE_PRIVATE_LEGACY_UI',{},'PRIVATE_LEGACY_UI_ROTATED')
        legacy_browser_closed=False
        try:
            legacy_chrome=role_client.request('START_PRIVATE_LEGACY_CHROME',{},'PRIVATE_LEGACY_CHROME_READY')
            legacy_input=dict(root=str(root),config=config,seed=seed,grant=http2_grant,ready=http2_identity,
                chromeEnvelope=dict(publicKey=config['originalHostEnrollment']['publicKey'],session=config['originalHostEnrollment']['session'],envelope=role_client.private_legacy_chrome_receipt.envelope),
                carrierEnvelope=dict(publicKey=config['originalHostEnrollment']['publicKey'],session=config['originalHostEnrollment']['session'],envelope=role_client.private_legacy_carrier_receipt.envelope))
            legacy_output=root/'installed-legacy-paired-browser.stdout';legacy_errors=root/'installed-legacy-paired-browser.stderr'
            with legacy_output.open('xb') as out,legacy_errors.open('xb') as err:
                legacy_child=subprocess.Popen(['/usr/local/bin/node',str(root/'installed-legacy-paired-browser.mjs'),config['originalHostEnrollment']['publicKey'],config['originalHostEnrollment']['session']],
                    cwd=app,env=browser_env,stdin=subprocess.PIPE,stdout=out,stderr=err,pass_fds=(20,))
            OWNER['probes'].append(legacy_child);legacy_child.stdin.write(encoded(legacy_input));legacy_child.stdin.close();legacy_child.wait()
            legacy_raw=legacy_output.read_bytes();legacy_error=legacy_errors.read_bytes()
            role_client.request('WAIT_PRIVATE_LEGACY_CHROME_CLOSED',dict(actorId=legacy_chrome['actorId']),'PRIVATE_LEGACY_CHROME_CLOSED',actor_id=legacy_chrome['actorId'])
            role_client.request('RESTORE_PRIVATE_RETAINED_UI',{},'PRIVATE_LEGACY_UI_RESTORED')
            legacy_browser_closed=True
            if legacy_child.returncode!=0 or len(legacy_raw)>2*1024**2 or len(legacy_error)>65536:
                business_failure=RuntimeError('PRIVATE_ACTUAL_LEGACY_BROWSER_UNPROVEN')
            else:
                installed_legacy_routing=json.loads(legacy_raw)
                check(installed_legacy_routing.get('format')=='sabalan-installed-legacy-paired-browser/v1','PRIVATE_ACTUAL_LEGACY_BROWSER_FORMAT_INVALID')
                legacy_verified=role_client.request('VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS',dict(proofPath=str(legacy_output),proofSha256=hashlib.sha256(legacy_raw).hexdigest()),'PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED')
                check(len(legacy_verified['result']['browserReceipts'])==2,'PRIVATE_LEGACY_BROWSER_SQL_RECEIPTS_MISSING')
        except BaseException as failure:
            refused=getattr(role_client,'failed_closed',None)
            if not legacy_browser_closed:
                if not refused or refused.get('noWorkStarted') is not True or refused.get('kind')!='legacy-private-chrome':raise
                role_client.request('RESTORE_PRIVATE_RETAINED_UI',{},'PRIVATE_LEGACY_UI_RESTORED')
            business_failure=failure
    if business_failure is None:
        inquiry_point=role_client.request('START_ONLINE_POINT_INQUIRY',{},'ONLINE_POINT_INQUIRY_READY')
        online_point=role_client.request('RUN_ORIGINAL_ONLINE_CHECKPOINT',{},'ORIGINAL_ONLINE_CHECKPOINT_DONE')
        inquiry_point_closed=role_client.request('FINISH_ONLINE_POINT_INQUIRY',dict(actorId=inquiry_point['actorId']),'ONLINE_POINT_INQUIRY_DONE',actor_id=inquiry_point['actorId'])
        check(online_point['result']['originalPointOnlyClosed'] is True and online_point['result']['continuousWalQualified'] is False
            and online_point['result']['finalIntervalCompletion'] is False,'PRIVATE_POINT_ONLY_CLOSURE_UNPROVEN')
    role_client.request('PREPARE_PRIVATE_HTTP2',dict(actorId=http2['actorId']),'PRIVATE_HTTP2_PREPARED',actor_id=http2['actorId'])
    control=role_client.request('PREPARE_PRIVATE_HTTP',dict(actorId=actor_id),'PRIVATE_HTTP_PREPARE_AUTHORIZED')
    child.stdin.write(control['wire'].encode()+b'\n');child.stdin.flush();prepared=event('PREPARED')
    role_client.channel.emit('PRIVATE_HTTP_PREPARED',dict(actorId=actor_id,result=prepared))
    http2_closed=role_client.request('FINISH_PRIVATE_HTTP2',dict(actorId=http2['actorId']),'PRIVATE_HTTP2_DONE',http2_grant,actor_id=http2['actorId'])
    control=role_client.request('FINISH_PRIVATE_HTTP',dict(actorId=actor_id),'PRIVATE_HTTP_FINISH_AUTHORIZED')
    child.stdin.write(control['wire'].encode()+b'\n');child.stdin.flush();closed=event('CLOSED')
    child.wait();check(child.returncode==0,'PRIVATE_PAIR_HTTP_ORIGINAL_EXIT_FAILED')
    work_file=Path(grant['scope']['boundaryDirectory'])/'state.json'
    closure=dict(scopeSha256=grant['sha256'],originalPopenPid=child.pid,originalReturncode=child.returncode,
        nativeRawBase64=base64.b64encode(native_file.read_bytes()).decode(),workRawBase64=base64.b64encode(work_file.read_bytes()).decode())
    role_client.enrich_original_closure(closure,grant)
    closure['sql']=dict(visible=True,system=grant['scope']['database']['systemIdentifier'],oid=str(index['restoredOid']),sessions=0,prepared=0)
    after=resources();check(all(after['events'][key]==before['events'][key] for key in ['oom','oom_kill','oom_group_kill']),'PRIVATE_PAIR_HTTP_OOM_DELTA')
    OWNER['nativeClosed']=True
    role_client.channel.emit('PRIVATE_HTTP_CLOSED',dict(actorId=actor_id,result=closed,closure=closure))
    final=role_client.channel.receive('PRIVATE_QUALIFICATION_CLOSED').body
    check(final['qualificationId']==pair['qualificationId'] and final['originalPairClosed'] is True and final['fence']['phase']=='CLOSED','PRIVATE_PAIR_HOST_CLOSE_UNPROVEN')
    # Any later business/history assertion is a known-closed negative. A new
    # live verifier still prevents original_custody_closed() until it exits.
    OWNER['failureClosed']=True
    if business_failure is not None:
        OWNER['failureClosed']=True
        raise RuntimeError('PRIVATE_PAIR_BUSINESS_QUALIFICATION_FAILED') from business_failure
    check(len(browser_verified['result']['browserReceipts'])==2,'PRIVATE_INSTALLED_BROWSER_SQL_RECEIPTS_MISSING')
    executions=[]
    for ticket,post in zip(installed_routing['tickets'],installed_routing['posts']):
        rows=[row for row in browser_verified['result']['browserReceipts'] if row['ticketId']==ticket['id']]
        check(len(rows)==1 and post['status']==201,'PRIVATE_INSTALLED_BROWSER_SQL_RECEIPT_CHANGED')
        build=[item for item in installed_routing['publication']['registry']['builds'] if item['id']==ticket['buildId']]
        check(len(build)==1,'PRIVATE_INSTALLED_BROWSER_BUILD_CHANGED')
        client=dict(format='sabalan-installed-browser-form-response/v1',operationId=post['operationId'],buildId=ticket['buildId'],image=build[0]['image'],
            runtimeId=ticket['runtimeId'],method='POST',status=post['status'],requestCount=1,automaticNavigation=False,originalClientClosed=True,
            responseSha256=post['responseSha256'],storedBusinessReceiptSha256=hashlib.sha256(encoded(rows[0])).hexdigest())
        executions.append(dict(runtimeId=ticket['runtimeId'],intentRawBase64=post['intentRawBase64'],completionRawBase64=post['completionRawBase64'],clientRawBase64=base64.b64encode(encoded(client)).decode()))
    installed_routing_proof=dict(format='sabalan-original-installed-browser-routing/v1',proofDatabase=dict(name=index['restoredDatabase'],oid=str(index['restoredOid']),systemIdentifier=grant['scope']['database']['systemIdentifier']),
        publicationRawBase64=installed_routing['publicationRawBase64'],publicationSha256=installed_routing['publicationSha256'],executions=executions,
        originalNativeClosures=[closure,http2_closed['closure']],originalBrowserReport=installed_routing,originalSqlObserver=browser_verified)
    domain['result']['qualification']['installedBrowserProof']=installed_routing
    domain['result']['qualification']['installedLegacyBrowserProof']=installed_legacy_routing
    # Independent actual reads after BOTH canonical actors drained: no report
    # or native status substitutes for the surviving durable source/ack rows.
    verification_input=dict(probe_input,mode='verify',proofSha256=bridge['proofSha256'])
    verifier=subprocess.Popen(['/usr/local/bin/node',str(root/'private-pair-bridge-probe.mjs')],cwd=app,env=probe_env,
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);OWNER['probes'].append(verifier)
    verify_out,verify_err=verifier.communicate(encoded(verification_input))
    check(sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='"+index['restoredDatabase']+"')+(SELECT count(*) FROM pg_prepared_xacts WHERE database='"+index['restoredDatabase']+"')")=='0','PRIVATE_PAIR_AFTER_DRAIN_PROBE_SQL_NOT_CLOSED')
    check(verifier.returncode==0 and len(verify_out)<=2*1024**2 and len(verify_err)<=65536,'PRIVATE_PAIR_AFTER_DRAIN_PROBE_UNPROVEN')
    bridge_after_drain=json.loads(verify_out)
    check(bridge_after_drain['format']=='sabalan-private-pair-bridge-after-drain/v1'
        and bridge_after_drain['passResult'] is True,'PRIVATE_PAIR_AFTER_DRAIN_RESULT_UNPROVEN')
    check(history(index['restoredDatabase'])==coherent['migrationHistory'],'PRIVATE_PAIR_MIGRATION_HISTORY_CHANGED')
    check(sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='"+index['restoredDatabase']+"')+(SELECT count(*) FROM pg_prepared_xacts WHERE database='"+index['restoredDatabase']+"')")=='0','PRIVATE_PAIR_RESTORED_DATABASE_NOT_CLOSED')
    restore_spec=importlib.util.spec_from_file_location('installed_domain_second_restore',root/'installed-domain-coherent-restore.fixture.py')
    DOMAIN_RESTORE=importlib.util.module_from_spec(restore_spec);sys.modules[restore_spec.name]=DOMAIN_RESTORE;restore_spec.loader.exec_module(DOMAIN_RESTORE)
    installed_restore=DOMAIN_RESTORE.run(root,index,config,source,sql,history,write,check,role_client,domain['result']['qualification'],coherent)
    second=index['privateQualification']['domainRestore']['database']
    check(history(second)==coherent['migrationHistory'],'PRIVATE_DOMAIN_RESTORE_MIGRATION_HISTORY_CHANGED')
    check(sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='"+second+"')+(SELECT count(*) FROM pg_prepared_xacts WHERE database='"+second+"')")=='0','PRIVATE_DOMAIN_RESTORE_DATABASE_NOT_QUIET')
    sql('DROP DATABASE "'+second+'"')
    sql('DROP DATABASE "'+index['restoredDatabase']+'"')
    return dict(format='sabalan-original-private-qualification-pair/v1',productionAdmission=False,originalPairClosed=True,
        actualHttpTargets=2,twoHttpTargetsQualified=True,actualInstalledEntry=True,actualCanonicalWorkersStarted=True,
        actualProductionLegacy55Qualified=True,installedLegacyRouting=installed_legacy_routing,installedLegacySqlObserver=legacy_verified,
        originalOnlinePhysicalPoint=online_point,originalOnlinePointInquiryClosure=inquiry_point_closed,
        installedRouting=installed_routing_proof,installedDomainRestore=installed_restore,installedDomainWriters=domain,bridge=bridge,bridgeProofRawBase64=base64.b64encode((app/'private-pair-bridge-proof.json').read_bytes()).decode(),bridgeAfterDrain=bridge_after_drain,hostClosed=final,originalHttpClosure=closure,originalHttpClosures=[closure,http2_closed['closure']],originalJobsClosure=job_closed['closure'],originalJobsClosures=[old_job_closure,job_closed['closure']],workerOwnershipIntervals=[old_job_closure['ownershipInterval'],job_closed['closure']['ownershipInterval']],resourcesBefore=before,resourcesAfter=after)

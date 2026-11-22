"""Data-only classification of original coordinator-owned execution receipts.

This module grants no authority. Its caller must bind staged bytes to the genuine
coordinator file inventory. Diagnostic source workflows cannot satisfy these rows.
"""
import base64
import hashlib
import json
import re

DOMAINS=('accounting','contracts','dispatch','hr','inquiry','personnel-performance','security','support','uploads')
def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
def raw_json(row,key):
    try:return json.loads(base64.b64decode(row[key],validate=True))
    except (KeyError,ValueError,TypeError):return {}
def closed_http(closure,runtime_id,image=None,database=None):
    native=raw_json(closure,'nativeRawBase64');scope=native.get('onlineScope',{}).get('scope',{})
    sql=closure.get('sql',{})
    return (scope.get('runtimeId')==runtime_id and scope.get('purpose')=='http'
        and (image is None or scope.get('image')==image)
        and native.get('onlineScope',{}).get('sha256')==closure.get('scopeSha256')
        and isinstance(closure.get('scopeSha256'),str)
        and (database is None or (scope.get('database',{}).get('name')==database.get('name')
             and scope.get('database',{}).get('systemIdentifier')==database.get('systemIdentifier')
             and str(sql.get('oid'))==str(database.get('oid'))
             and str(sql.get('system'))==str(database.get('systemIdentifier'))))
        and native.get('phase')=='QUIESCENT' and native.get('nativeReaped') is True
        and native.get('databaseQuiet') is True and native.get('nativeStatus')==0
        and native.get('stoppedBySignal') is False and closure.get('originalReturncode')==0
        and sql.get('visible') is True and sql.get('sessions')==sql.get('prepared')==0)
def derive(pair,retained,pristine,schema_sha256):
    if not isinstance(schema_sha256,str) or not re.fullmatch('[a-f0-9]{64}',schema_sha256):raise ValueError('CURRENT_SCHEMA_IDENTITY_REQUIRED')
    rows=[]
    def add(domain,receipt,**facts):
        rows.append(dict(domain=domain,status='COMPLETE',receiptSha256=digest(receipt),actualCanonicalRuntime=True,schemaSha256=schema_sha256,**facts))
    result=pair.get('installedDomainWriters',{}).get('result',{});q=result.get('qualification',{})
    closures=pair.get('originalHttpClosures',[])
    live_proof=(pair.get('originalPairClosed') is True and pair.get('actualInstalledEntry') is True
        and result.get('observerDisconnected') is True and result.get('durableStateReadback') is True
        and q.get('format')=='sabalan-installed-domain-writers/v1' and q.get('diagnosticServiceGraphImported') is False
        and any(closed_http(c,q.get('runtimeId'),q.get('image'),q.get('database',{})) for c in closures))
    if live_proof:
        identity=dict(runtimeId=q['runtimeId'],image=q['image'],database=q['database'])
        financial=q.get('financial',{});pdf=q.get('accountingPdf',{})
        if financial.get('voucherId') and financial.get('explicitIdempotencyReplaySameVoucher') is True:add('accounting',dict(qualification=q,closures=closures),**identity)
        if pdf.get('key') and pdf.get('sha256') and pdf.get('versionSha256'):add('contracts',dict(pdf=pdf,closures=closures),**identity)
        dispatch=q.get('dispatch',{})
        if (dispatch.get('profile')=='PRE_CUTOVER_LEGACY_WAYBILL_ONLY' and dispatch.get('waybillId')
            and dispatch.get('atomicStatementFeatureEnabled') is False and dispatch.get('missingArtifactRefused404') is True):
            add('dispatch',dict(dispatch=dispatch,closures=closures),currentProductionProfile=dispatch['profile'],futureAtomicIssuanceQualified=False,**identity)
        personnel=q.get('personnel',{})
        if personnel.get('cleanupId') and personnel.get('deleteVersionSha256'):add('hr',dict(personnel=personnel,closures=closures),**identity)
        ancillary=q.get('ancillary',{});security=ancillary.get('security',{});uploads=ancillary.get('uploads',{})
        if security.get('versionSha256') and security.get('rejectedCategory404NoLiveChanges') is True:add('security',dict(security=security,closures=closures),**identity)
        if uploads.get('versionSha256') and uploads.get('sha256'):add('uploads',dict(uploads=uploads,closures=closures),**identity)
    routing=pair.get('installedRouting',{});observer=routing.get('originalSqlObserver',{}).get('result',{})
    if (pair.get('originalPairClosed') is True and routing.get('format')=='sabalan-original-installed-browser-routing/v1'
        and observer.get('observerDisconnected') is True and len(observer.get('browserReceipts',[]))==2
        and len(routing.get('executions',[]))==2):
        clients=[raw_json(row,'clientRawBase64') for row in routing['executions']]
        if all(c.get('status')==201 and c.get('requestCount')==1 and c.get('storedBusinessReceiptSha256')
            and any(closed_http(n,c.get('runtimeId')) for n in closures) for c in clients):add('support',routing)
    inquiry=retained.get('inquiry',{});browser=inquiry.get('browser',{});sqlite_schema=retained.get('schema',{})
    if (retained.get('pass') is True and inquiry.get('qualificationSuccess') is True
        and inquiry.get('allOriginalChildrenClosed') is True and len(inquiry.get('rows',[]))==4
        and sqlite_schema.get('actualImagePrismaDbPush') is True and sqlite_schema.get('originalCliClosed') is True
        and all(isinstance(sqlite_schema.get(k),str) and re.fullmatch('[a-f0-9]{64}',sqlite_schema[k]) for k in ('canonicalSchemaSha256','installedSchemaSha256'))
        and browser.get('actualNativeFormSubmissions')==4 and browser.get('hydratedNativeForms')==2
        and browser.get('htmlNativeForms')==2 and inquiry.get('sqlite',{}).get('sha256')):
        natives=[raw_json(c,'nativeRawBase64') for c in inquiry.get('closures',{}).values()]
        if len(natives)==2 and all(n.get('phase')=='QUIESCENT' and n.get('nativeReaped') is True and n.get('sqliteNativeClosed') is True for n in natives):
            add('inquiry',inquiry,storageEngine='SQLITE',sqliteCanonicalSchemaSha256=sqlite_schema['canonicalSchemaSha256'],sqliteInstalledSchemaSha256=sqlite_schema['installedSchemaSha256'],currentInquiryRuntimeQualified=True,actualProductionLegacyQualified=retained.get('actualProductionInquiryLegacyQualified') is True)
    p=pristine.get('result',{});profile=p.get('result',{});closure=pristine.get('closure',{})
    if (p.get('format')=='sabalan-installed-pristine-performance-result/v1' and p.get('observerDisconnected') is True
        and p.get('installedApplicationSha256') and p.get('runtimeBundleSha256')
        and closed_http(closure,p.get('runtimeId'),database=p.get('database',{}))
        and profile.get('format')=='sabalan-installed-disabled-performance-profile/v1'
        and profile.get('httpStatus')==403 and profile.get('actualInstalledAuthorization') is True
        and profile.get('releasePhaseCreated') is False and profile.get('legacyCatalogActive') is False
        and profile.get('exportRowsMinted')==profile.get('liveArtifactChanges')==0
        and profile.get('futureEnabledExportsQualified') is False):
        add('personnel-performance',pristine,actualInstalledProductionProfile=True,enabledWriterQualified=False,futureEnabledExportsQualified=False)
    rows.sort(key=lambda row:row['domain']);covered={row['domain'] for row in rows}
    return dict(domainCases=rows,writerCoverage=dict(retainedRootsEnrolled=9 if pair.get('installedDomainRestore',{}).get('passResult') is True and pair.get('installedDomainRestore',{}).get('restoredFileRoots')==9 else 0,startupOnly=[],remaining=[d for d in DOMAINS if d not in covered],
        exercised=sorted(covered),workflowReceipts=[dict(workflow=row['domain'],receiptSha256=row['receiptSha256']) for row in rows]),
        actualProductionInquiryLegacyQualified=retained.get('actualProductionInquiryLegacyQualified') is True)

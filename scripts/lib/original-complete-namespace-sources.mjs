/** Exact successors of the reviewed staging/retirement helpers. Preserve every
 * pre-existing entry instead of requiring a falsely empty LOCAL namespace. */
import assert from'node:assert/strict';import{createHash}from'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const once=(s,a,b)=>{assert.equal(s.split(a).length-1,1,'COMPLETE_NAMESPACE_SOURCE_SEAM_CHANGED');return s.replace(a,b);};
export function renderOriginalCompleteNamespaceSources({namespace,receiver,terminal,cleanup}){
 assert.equal(sha(receiver),'1a5afe9e105b902d8bfa113a4b9aa3006877bfe497d265a1b9bd9d962f953ee1');assert.equal(sha(terminal),'052edee21768d887c158a01a3ad174fcb1067af89b5be118174cd391cdb244f3');assert.equal(sha(cleanup),'751f962033c1cb30dfd89dfada04474822a5a899454b90e388e83f9388b2be83');
 let r=receiver.toString(),t=terminal.toString(),c=cleanup.toString();
 r=once(r,"need(original==expected_namespace and list(base.iterdir())==[])","need(original==expected_namespace);preserved=preserved_authority_snapshot(base)");
 r=once(r,"need(directory(base)==before and os.listdir(base)==[root.name])","need(directory(base)==before);assert_preserved_authority(base,preserved,root.name)");
 r=once(r,"'format':'sabalan-local-strict-material-parent/v1'","'format':'sabalan-local-strict-material-parent/v2'");
 r=once(r,"'authorityRootInitiallyEmpty':True","'existingAuthority':write_preserved_authority(root,preserved),'authorityRootInitiallyEmpty':not bool(preserved['entries']),'existingAuthorityPreserved':True");
 t=once(t,'def retire(operation,initial,pins):','def retire(operation,initial,pins,grant):');
 t=once(t,"initial['format']=='sabalan-local-strict-material-parent/v1'","initial['format']=='sabalan-local-strict-material-parent/v2'");
 t=once(t,"initial['authorityRootInitiallyEmpty']is True","initial['existingAuthorityPreserved']is True");
 t=once(t,"need(directory(root)==initial['rootDirectoryIdentity']and directory(root/'strict-complete-material')==initial['stageDirectoryIdentity']and os.listdir(BASE)==[root.name])","preserved=read_preserved_authority(root,initial['existingAuthority']);need(grant is not None);need(directory(root)==initial['rootDirectoryIdentity']and directory(root/'strict-complete-material')==initial['stageDirectoryIdentity']);assert_preserved_authority(BASE,preserved,root.name,grant)");
 t=once(t,"need(directory(BASE)==base_identity and directory(root)==initial['rootDirectoryIdentity']);closed_native(active,final)","need(directory(BASE)==base_identity and directory(root)==initial['rootDirectoryIdentity']);assert_preserved_authority(BASE,preserved,root.name,grant);closed_native(active,final)");
 t=once(t,"need(directory(BASE)==base_identity and os.listdir(BASE)==[]and not root.exists())","need(directory(BASE)==base_identity and not root.exists());assert_preserved_authority(BASE,preserved,root.name,grant)");
 t=once(t,"'authorityEmpty':True","'authorityEmpty':not bool(os.listdir(BASE)),'existingAuthorityPreserved':True");
 c=once(c,"initial['format']=='sabalan-local-strict-material-parent/v1'","initial['format']=='sabalan-local-strict-material-parent/v2'");
 c=once(c,"initial['authorityRootInitiallyEmpty']is True","initial['existingAuthorityPreserved']is True and initial['existingAuthority']['format']=='sabalan-existing-authority-snapshot-reference/v1'");
 c=once(c,"value['authorityEmpty']is True","value['existingAuthorityPreserved']is True");
 c=once(c,'def local_command(binding,pins,initial):','def local_command(binding,pins,initial,capture):');
 c=once(c,'validate_initial(initial,binding)\n source=',"validate_initial(initial,binding);grant=closed_inquiry_grant(capture,operation)\n source=");
 c=once(c,"+repr(pins)+'),separators=","+repr(pins)+','+repr(grant)+'),separators=");
 return{receiver:Buffer.from(namespace+'\n'+r),terminal:Buffer.from(namespace+'\n'+t),cleanup:Buffer.from(closedInquiryGrantSource+'\n'+c)};
}

const closedInquiryGrantSource=String.raw`def closed_inquiry_grant(capture,operation):
 import base64,json,hashlib,re
 assert capture['format']=='sabalan-original-complete-capture/v1' and capture['request']['operation']==operation and capture['workerClosedBeforeCapture']is True and capture['cleanupStarted']is False
 rows=[r for r in capture['probe']['originals']if r.get('role')=='inquiry'];assert len(rows)==1
 def decoded(row):
  raw=base64.b64decode(row['rawBase64'],validate=True);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];return json.loads(raw)
 expected=capture['inquiryExpected'];loaded=expected['scope'];scope=loaded['scope'];e=rows[0]['evidence'];final=decoded(e['finalNative']);retired=decoded(e['retirement'])
 assert retired['format']=='sabalan-restored-inquiry-retired/v1' and retired['retired']is True and retired['inputSqlite']==expected['inputSqlite'] and retired['originalDatabase']==expected['originalDatabase']
 assert retired['closure']['wrapperStatus']==128 and retired['closure']['nativeStatus']==143 and retired['closure']['naturalExitZero']is False
 assert final['phase']=='QUIESCENT' and final['onlineScope']==loaded
 assert re.fullmatch('[a-f0-9]{64}',scope['runtimeId']) and scope['releaseId']=='qa-complete-inquiry-'+operation
 raw=(json.dumps(scope,sort_keys=True,separators=(',',':'))+'\n').encode('ascii');assert hashlib.sha256(raw).hexdigest()==loaded['sha256']
 return {'name':scope['runtimeId']+'.json','sha256':loaded['sha256'],'bytes':len(raw),'device':loaded['device'],'inode':loaded['inode']}
`;

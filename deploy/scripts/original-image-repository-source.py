"""Pure backup source packaging; caller data is not runtime authority."""
import hashlib
import json
import pathlib
import re
import runpy

HERE=pathlib.Path(__file__).resolve().parent
Q=pathlib.Path('D:/sabalanerp-online-qa')


def original_backup_collector(source):
    production=Q/'C30-source-a-no-workspace-stream-owner-source-r7-deployment-profile-20261025'
    captured=source['captured_sources'](production,'2f85bb5addcbc798b485327bf428da0f073ba55cd5c832720b174391f08d5031')
    collector=source['replace_once'](captured['stream-native.py'].decode(),'pass_fds=(9,),','pass_fds=(9,10),')
    collector=source['replace_once'](collector,'host.lock_guard();faults={};overflow=False;hashes={};counts={};eof={}','host.lock_guard();faults={};overflow=False;hashes={};counts={};eof={};host.verifier_eof[0]=eof')
    return source['replace_once'](collector,' # SAME two pipe objects and child remain held',' host.active_verifier[0]=child\n # SAME two pipe objects and child remain held')


def build(operation, full_operation, images, capacity, observed_at, source, channel_source, remote_source):
    assert re.fullmatch('[a-f0-9]{32}',operation) and re.fullmatch('[a-f0-9]{32}',full_operation)
    assert set(images)=={'backend','inquiry','frontend'}
    component=source['component']()
    assert images['backend']['image']==component['image'] and images['backend']['gzip']==component['gzip']
    accepted={
        'inquiry':('sha256:7b029f245af9ad80ca85d92df38996ac268821b62732b9b325901d697295e1b9',379561755,'1364dd636fafe4fbdc620833d3b1f98f8cddb781352382fdc4dce9f088d4bc0e'),
        'frontend':('sha256:008388c7f0188170b46b7466f534398f91894f12770a96c9af96a4f6cc90e040',269929059,'3ebbeafe68d57788847b10fc5d75176235f3ee48324ea9fd67b4a138517b93d3')}
    for role,row in images.items():
        assert set(row)=={'image','gzip','cipher','archiveGraph'}
        assert row['archiveGraph']['index']==row['image']
        assert type(row['cipher']['bytes']) is int and 0<row['cipher']['bytes']<=2**31
        assert re.fullmatch('[a-f0-9]{64}',row['cipher']['sha256'])
        if role in accepted:
            image,count,digest=accepted[role]
            assert row['image']==image and row['cipher']['bytes']==count and row['cipher']['sha256']==digest
    assert capacity['format']=='sabalan-c3-image-capacity-original/v1'
    assert capacity['operation']==operation and capacity['producerImage']==source['PRODUCER']
    assert capacity['allOriginalChildrenClosed'] is True and capacity['sourceWorkspaceCreated'] is False
    assert capacity['productionAdmission'] is False and capacity['privateKeyRead'] is False
    reserve=capacity['capacity']['backupCanonicalReserveBytes']
    assert type(reserve) is int and reserve>0
    captured=source['captured_sources'](source['REVIEW'],source['REVIEW_SHA'])
    builder=source['execute_source'](captured['build-independent.py'],source['REVIEW']/'build-independent.py','image_repository_guard_source')
    guards=builder['fixed_guards']()
    core=source['captured_sources'](source['CORE'],source['CORE_SHA'])
    crypto=captured['verify-independent.cjs'].decode()
    crypto=source['replace_once'](crypto,source['PRODUCER'],component['image'])
    expected=dict(cipherBytes=images['backend']['cipher']['bytes'],cipherSha256=images['backend']['cipher']['sha256'],image=component['image'],plainBytes=component['gzip']['bytes'],plainSha256=component['gzip']['sha256'])
    crypto=source['replace_once'](crypto,'const BOUND=null;','const BOUND='+json.dumps(expected,sort_keys=True)+';')
    collector=original_backup_collector(source)
    transfer_file=HERE.parents[1]/'tests/online-deployment/independent-image-transfer.fixture.py'
    transfer=source['pinned'](transfer_file,'55d6390c6cc87c62a0484ec46a871b32ba97fcdb2a57aa9214512eb9671ee9ca').decode()
    # These two successor files are consumed from the containing frozen source
    # snapshot by the image owner; this file-only builder mints no capability.
    assert isinstance(channel_source,bytes) and isinstance(remote_source,bytes)
    constants=dict(OPERATION=operation,FULL_OPERATION=full_operation,IMAGES=images,
                   CANONICAL_RESERVE=reserve,CAPACITY_OBSERVED_AT=observed_at,
                   BACKUP_ABSENT=[str(pathlib.PurePosixPath('/root/sabalan-recovery-private')/('transfer-material-'+full_operation)),str(pathlib.PurePosixPath('/root/sabalan-recovery-private')/('transfer-'+full_operation))],
                   FILES={'verify.cjs':crypto.encode(),'stream-codec.cjs':core['stream-codec.cjs']},
                   COLLECTOR_SOURCE=collector,TRANSFER_SOURCE=transfer,CHANNEL_SOURCE=channel_source.decode())
    raw=(guards+'\n'+'\n'.join(name+'='+repr(value) for name,value in constants.items())+'\n').encode()+remote_source+b'\nif __name__=="__main__":sys.exit(run_repository())\n'
    assert len(raw)<=1024**2
    compile(raw,'image-repository-fixed-backup-source','exec')
    digest=hashlib.sha256(raw).hexdigest()
    bootstrap="import hashlib,sys;r=sys.stdin.buffer.read("+str(len(raw))+");assert len(r)=="+str(len(raw))+" and hashlib.sha256(r).hexdigest()=="+repr(digest)+";exec(compile(r,'same-original-backup-source','exec'),{'__name__':'__main__'})"
    import shlex
    command='python3 -I -B -c '+shlex.quote(bootstrap)
    assert len(command)<16000
    return dict(source=raw,command=command,sha256=digest,bytes=len(raw),fullOperation=full_operation,productionAdmission=False)

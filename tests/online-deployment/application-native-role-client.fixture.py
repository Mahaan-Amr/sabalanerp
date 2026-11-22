"""Main original controller's typed requests, not a PID adoption interface."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import secrets
import sys


class OriginalRoleClient:
    def __init__(self, root, public_key, session, config, index, sql, check):
        spec = importlib.util.spec_from_file_location('original_host_channel', root / 'original-host-controller-channel.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        self.channel = module.OriginalHostChannel(public_key, session, 'main')
        self.is_empty_read = module.is_original_channel_empty_read
        self.channel.emit('HELLO', dict(role='main', pid=__import__('os').getpid()))
        enrollment = self.channel.receive('ENROLL').body
        check(enrollment['index'] == index and enrollment['roleTopology'] == config['roleTopology'], 'APPLICATION_ROLE_ENROLLMENT_CHANGED')
        for name, digest in enrollment['files'].items():
            check(Path(name).name == name and hashlib.sha256((root / name).read_bytes()).hexdigest() == digest,
                  'APPLICATION_ROLE_SOURCE_CHANGED')
        check(config['originalHostEnrollment']['publicKey'] == public_key
              and config['originalHostEnrollment']['session'] == session, 'APPLICATION_ROLE_HOST_KEY_CHANGED')
        self.root, self.sql, self.check, self.index = root, sql, check, index
        self.actors, self.chrome_receipt = {}, None
        self.request_count, self.failed_receive = 0, None

    def request(self, command, input, expected, grant=None, actor_id=None):
        request_id = secrets.token_hex(32)
        self.request_count += 1
        self.channel.emit('REQUEST', dict(command=command, requestId=request_id, input=input, actorId=actor_id))
        try:
            receipt = self.channel.receive({expected, 'PHASE_FAILED', 'PHASE_REFUSED'})
        except BaseException as error:
            if command == 'RUN_MIGRATION' and self.is_empty_read(error):
                self.failed_receive = dict(requestId=request_id, command=command, expected=expected,
                    reason='ORIGINAL_HOST_CHANNEL_EMPTY_READ')
            raise
        body = receipt.body
        self.check(body['requestId'] == request_id, 'APPLICATION_ROLE_REPLY_CHANGED')
        if receipt.command == 'PHASE_REFUSED':
            self.check(body['failedEvent'] == expected and body['decision'] == 'NATIVE_ACTOR_NOT_STARTED'
                  and body['noWorkStarted'] is True and body['actorId'] is None, 'APPLICATION_ROLE_REFUSAL_UNPROVEN')
            self.failed_closed = body
            raise RuntimeError('APPLICATION_ROLE_PREACTOR_CAPACITY_REFUSED')
        if receipt.command == 'PHASE_FAILED':
            if command in {'RUN_PRIVATE_DOMAIN_CASES','VERIFY_PRIVATE_DOMAIN_RESTORE','VERIFY_PRIVATE_BROWSER_TICKETS','VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS'}:
                closure=body['closure'];self.check(body['failedEvent'] == expected and body['result']['originalKnownClosed'] is True
                    and closure['scopeSha256'] is None and closure['nativeRawBase64'] is None
                    and closure['sql']['visible'] is True and closure['sql']['sessions'] == closure['sql']['prepared'] == 0,
                    'APPLICATION_ROLE_DOMAIN_FAILURE_CLOSURE_UNPROVEN')
                self.failed_closed=body
                raise RuntimeError('APPLICATION_ROLE_INSTALLED_DOMAIN_FAILED_CLOSED')
            self.check(grant is not None and body['failedEvent'] == expected, 'APPLICATION_ROLE_FAILURE_SCOPE_UNPROVEN')
            self.verify_closure(body, grant, body['closure']['originalReturncode'])
            self.failed_closed = body
            raise RuntimeError('APPLICATION_ROLE_QUALIFICATION_FAILED_' + body['qualificationError'])
        if expected == 'CHROME_READY':
            self.chrome_receipt = receipt
            self.actors['chrome'] = body['actorId']
        elif expected == 'RESTORED_HTTP_READY':
            self.actors['restored-http'] = body['actorId']
        elif expected == 'PRIVATE_CHROME_READY':
            self.private_chrome_receipt=receipt
            self.actors['private-chrome']=body['actorId']
        elif expected == 'PRIVATE_LEGACY_CHROME_READY':
            self.private_legacy_chrome_receipt=receipt
            self.actors['legacy-private-chrome']=body['actorId']
        elif expected == 'PRIVATE_LEGACY_UI_ROTATED':
            self.private_legacy_carrier_receipt=receipt
        elif expected == 'PRIVATE_HTTP2_READY':
            self.actors['private-http2'] = body['actorId']
        elif expected == 'PRIVATE_JOBS_READY':
            self.actors['private-jobs'] = body['actorId']
        elif expected == 'CHROME_CLOSED':
            self.chrome_closed = True
        if grant is not None and expected not in ['RESTORED_HTTP_READY', 'PRIVATE_JOBS_READY', 'PRIVATE_HTTP2_READY']:
            self.verify_closure(body, grant, 128 if command == 'RUN_RESTORED_INQUIRY' else 0)
        return body

    def enrich_original_closure(self, closure, grant):
        """Attach only actual original-namespace bytes after fresh verify_closure."""
        self.verify_closure(dict(closure=closure),grant,closure['originalReturncode'])
        boundary=Path(grant['scope']['boundaryDirectory'])
        claim_raw=(boundary/'claim.json').read_bytes();scope_raw=(boundary/'scope.json').read_bytes()
        native=json.loads(base64.b64decode(closure['nativeRawBase64'],validate=True));claim=json.loads(claim_raw)
        namespace='sabalan-rt-'+hashlib.sha256(grant['scope']['runtimeId'].encode()).hexdigest()[:48]
        database=grant['scope']['database']['name'];oid=self.index['restoredOid'] if database==self.index['restoredDatabase'] else (self.index['oid'] if database==self.index['database'] else self.index['privateQualification']['domainRestore']['databaseOid'])
        closure.update(runtimeId=grant['scope']['runtimeId'],activeClaimSha256=native['activeClaimSha256'],claimNative=claim['native'],
            workClaimRawBase64=base64.b64encode(claim_raw).decode(),workScopeRawBase64=base64.b64encode(scope_raw).decode(),
            freshSql=dict(visible=True,systemIdentifier=grant['scope']['database']['systemIdentifier'],databaseOid=str(oid),namespace=namespace,namespaceSessions=0,prepared=0))
        return closure

    def verify_closure(self, body, grant, status):
        closure = body['closure']
        native_path = Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json'
        native_raw = native_path.read_bytes()
        work_raw = (Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes()
        self.check(native_raw == base64.b64decode(closure['nativeRawBase64'], validate=True)
              and work_raw == base64.b64decode(closure['workRawBase64'], validate=True), 'APPLICATION_ROLE_CLOSURE_BYTES_CHANGED')
        native, work = json.loads(native_raw), json.loads(work_raw)
        self.check(native['onlineScope']['scope'] == grant['scope'] and native['onlineScope']['sha256'] == grant['sha256']
              and closure['scopeSha256'] == grant['sha256'] and native['guardian']['pid'] == closure['originalPopenPid']
              and native['phase'] == work['phase'] == 'QUIESCENT' and native['nativeReaped']
              and closure['originalReturncode'] == status and native['stoppedBySignal'] == (native.get('format') == 'sabalan-inquiry-native/v2'),
              'APPLICATION_ROLE_ORIGINAL_CLOSURE_UNPROVEN')
        inquiry = native.get('format') == 'sabalan-inquiry-native/v2'
        if inquiry:
            self.check(status == 128, 'APPLICATION_ROLE_INQUIRY_STOP_STATUS_CHANGED')
            self.check(native['sqliteNativeClosed'] and native['nativeStatus'] == 143
                  and body['result']['requestedSigterm'] and body['result']['nativeSha256'] == hashlib.sha256(native_raw).hexdigest(),
                  'APPLICATION_ROLE_REQUESTED_SQLITE_STOP_UNPROVEN')
        else:
            self.check(native['databaseQuiet'] and native['nativeStatus'] == status, 'APPLICATION_ROLE_DATABASE_GUARDIAN_NOT_CLOSED')
        claim = json.loads((Path(grant['scope']['boundaryDirectory']) / 'claim.json').read_bytes())
        self.check(claim['native'] == dict(scopeSha256=grant['sha256'], claimSha256=native['activeClaimSha256']),
              'APPLICATION_ROLE_WORK_CLAIM_CHANGED')
        visible = self.sql("SELECT (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member'))::text FROM pg_roles WHERE rolname=current_user")
        database = grant['scope']['database']['name']
        expected_oid = self.index['restoredOid'] if database == self.index['restoredDatabase'] else (self.index['oid'] if database == self.index['database'] else self.index['privateQualification']['domainRestore']['databaseOid'])
        namespace = 'sabalan-rt-' + hashlib.sha256(grant['scope']['runtimeId'].encode()).hexdigest()[:48]
        self.check(visible == 'true' and self.sql("SELECT system_identifier::text FROM pg_control_system()") == grant['scope']['database']['systemIdentifier']
              and self.sql("SELECT oid::text FROM pg_database WHERE datname='" + database + "'") == expected_oid
              and self.sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "'") == '0'
              and self.sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + database + "'") == '0',
              'APPLICATION_ROLE_FRESH_SQL_CLOSURE_UNPROVEN')


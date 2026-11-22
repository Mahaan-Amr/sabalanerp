import importlib.util
from pathlib import Path
import unittest
import json,base64

class CoverageTests(unittest.TestCase):
    def setUp(self):
        path=Path(__file__).with_name('installed-writer-coverage.fixture.py')
        spec=importlib.util.spec_from_file_location('coverage_classifier',path)
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
    def test_empty_and_diagnostic_receipts_never_close_installed_domains(self):
        value=self.module.derive({}, {}, {'diagnosticSourceBundle':True}, 'a'*64)
        self.assertEqual(value['domainCases'],[])
        self.assertEqual(len(value['writerCoverage']['remaining']),9)
        self.assertFalse(value['actualProductionInquiryLegacyQualified'])
    def test_unclosed_installed_payload_is_not_a_business_receipt(self):
        pair={'installedDomainWriters':{'result':{'qualification':{'format':'sabalan-installed-domain-writers/v1','runtimeId':'runtime','image':'sha256:'+'b'*64,'financial':{'voucherId':'v'}}}}}
        self.assertEqual(self.module.derive(pair,{}, {},'a'*64)['domainCases'],[])
    def test_diagnostic_performance_cannot_stand_in_for_pristine_installed_role(self):
        profile={'result':{'format':'sabalan-installed-pristine-performance-result/v1','result':{'httpStatus':403,'actualInstalledAuthorization':True},'observerDisconnected':True}}
        self.assertNotIn('personnel-performance',[r['domain'] for r in self.module.derive({}, {},profile,'a'*64)['domainCases']])

    def test_installed_pristine_requires_matching_native_database_and_real_closure(self):
        database={'name':'qa_application_native_'+'a'*32,'oid':'42','systemIdentifier':'123'}
        native={'phase':'QUIESCENT','nativeReaped':True,'databaseQuiet':True,'nativeStatus':0,'stoppedBySignal':False,
            'onlineScope':{'sha256':'c'*64,'scope':{'purpose':'http','runtimeId':'runtime','image':'sha256:'+'d'*64,'database':{'name':database['name'],'systemIdentifier':'123'}}}}
        closure={'nativeRawBase64':base64.b64encode(json.dumps(native).encode()).decode(),'scopeSha256':'c'*64,'originalReturncode':0,'sql':{'visible':True,'sessions':0,'prepared':0,'oid':'42','system':'123'}}
        profile={'result':{'format':'sabalan-installed-pristine-performance-result/v1','runtimeId':'runtime','database':database,'installedApplicationSha256':'e'*64,'runtimeBundleSha256':'f'*64,'observerDisconnected':True,
            'result':{'format':'sabalan-installed-disabled-performance-profile/v1','httpStatus':403,'actualInstalledAuthorization':True,'releasePhaseCreated':False,'legacyCatalogActive':False,'exportRowsMinted':0,'liveArtifactChanges':0,'futureEnabledExportsQualified':False}},'closure':closure}
        rows=self.module.derive({}, {},profile,'a'*64)['domainCases']
        self.assertEqual([row['domain'] for row in rows],['personnel-performance'])
        self.assertFalse(rows[0]['enabledWriterQualified'])
        profile['result']['database']={**database,'oid':'43'}
        self.assertEqual(self.module.derive({}, {},profile,'a'*64)['domainCases'],[])

if __name__=='__main__':unittest.main()

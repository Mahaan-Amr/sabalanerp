"""D-only tests: actual draft functions; filesystem native, process/advice fake."""
import ast
import hashlib
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
import importlib.util

D = Path(__file__).parent
spec = importlib.util.spec_from_file_location('prior_cache_tests', D/'application-native-prisma-cache.test.py')
prior = importlib.util.module_from_spec(spec); spec.loader.exec_module(prior)

class PostPristineTests(prior.CacheTests):
    def dist_fixture(self, active=None):
        fn, root, roots, advised, held, before = self.fixture(active=active)
        dist=root.parent/'dist'; dist.mkdir()
        (dist/'application.js').write_bytes(b'actual installed application fixture')
        (dist/'application.js.map').write_bytes(b'inactive map fixture')
        rows=[dict(bytes=p.stat().st_size,path=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(dist.iterdir())]
        expected=hashlib.sha256(json.dumps(rows,separators=(',', ':')).encode()).hexdigest()
        original=fn.__globals__['Path']
        fn.__globals__['Path']=lambda value: dist if str(value)=='/app/dist' else original(value)
        return fn,root,dist,expected,advised,held

    def test_dist_exact_aggregate_before_bounded_summary(self):
        fn,root,dist,expected,advised,held=self.dist_fixture()
        result=fn(root,prior.check,expected)
        self.assertEqual(result['verifiedDistFileCount'],2)
        self.assertEqual(result['hintedFileCount'],11)
        self.assertNotIn('files',result)
        self.assertLess(len(json.dumps(result)),1024)
        self.assertEqual(result['acceptedDistTreeSha256'],expected)
        self.assertFalse(result['cacheCreditUsed']); self.assertFalse(held)

    def test_nested_dist_canonical_hash_native_lookup(self):
        fn,root,dist,expected,advised,held=self.dist_fixture()
        nested=dist/'services'/'nested';nested.mkdir(parents=True)
        target=nested/'worker.js';target.write_bytes(b'nested installed worker')
        rows=[dict(bytes=p.stat().st_size,path=p.relative_to(dist).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in dist.rglob('*') if p.is_file()]
        rows.sort(key=lambda row:row['path'])
        expected=hashlib.sha256(json.dumps(rows,separators=(',', ':')).encode()).hexdigest()
        result=fn(root,prior.check,expected)
        self.assertEqual(result['verifiedDistFileCount'],3)
        self.assertIn(target.stat().st_ino,advised);self.assertFalse(held)

    def test_bad_aggregate_advises_nothing_and_closes_all(self):
        fn,root,dist,expected,advised,held=self.dist_fixture()
        with self.assertRaisesRegex(RuntimeError,'DIST_AGGREGATE_CHANGED'):
            fn(root,prior.check,'0'*64)
        self.assertFalse(advised);self.assertFalse(held)

    def test_unknown_proc_refs_skip_dist_too(self):
        fn,root,dist,expected,advised,held=self.dist_fixture(active='unreadable')
        result=fn(root,prior.check,expected)
        self.assertEqual(result['hintedFileCount'],0)
        self.assertEqual(result['skippedActiveOrUnprovenFileCount'],11)
        self.assertFalse(advised);self.assertFalse(held)

    def test_dist_active_or_denied_maps_never_advised(self):
        for denied in (False,True):
            with self.subTest(denied=denied):
                fn,root,dist,expected,advised,held=self.dist_fixture()
                inode=(dist/'application.js').stat().st_ino
                device=(dist/'application.js').stat().st_dev
                class Fds:
                    def iterdir(self):return []
                class Maps:
                    def read_text(self):
                        if denied:raise PermissionError('fixture maps unknown')
                        return f'0000-ffff r--p 0 0:0 {inode} /fixture\n'
                class Process:
                    name='987654321'
                    def __truediv__(self,key):return Fds() if key=='fd' else Maps()
                class Proc:
                    def iterdir(self):return [Process()]
                original=fn.__globals__['Path']
                fn.__globals__['Path']=lambda value:Proc() if str(value)=='/proc' else original(value)
                fn.__globals__['os'].makedev=staticmethod(lambda *args:device)
                fn(root,prior.check,expected)
                self.assertNotIn(inode,advised);self.assertFalse(held)

    def test_changed_dist_after_aggregate_never_advised(self):
        fn,root,dist,expected,advised,held=self.dist_fixture()
        target=dist/'application.js'
        original=fn.__globals__['os'].posix_fadvise
        def advice(*args):
            target.write_bytes(b'changed installed app fixture')
            return original(*args)
        fn.__globals__['os'].posix_fadvise=advice
        with self.assertRaisesRegex(RuntimeError,'HASH_CHANGED'):
            fn(root,prior.check,expected)
        self.assertNotIn(target.stat().st_ino,advised);self.assertFalse(held)

class OriginalBoundaryTests(unittest.TestCase):
    def run_method(self,closed=True,code=0,pump_live=False,missing=False):
        tree=ast.parse((D/'application-native-candidate-controller.fixture.py').read_text())
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='CandidateOwner')
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='pristine_performance')
        calls=[]; checksum='a'*64
        grant=dict(sha256='b'*64,scope=dict(image='sha256:'+'c'*64,manifestSha256=checksum,database=dict(name='fixture',systemIdentifier='1')))
        data_result=dict(format='sabalan-installed-pristine-performance-result/v1',scopeSha256=grant['sha256'],database=dict(name='fixture',oid='2',systemIdentifier='1'),runtimeBundleSha256=checksum,observerDisconnected=True)
        value=dict(id='actor',actor=types.SimpleNamespace(pid=123,returncode=code,stdin=io.BytesIO()),closed=closed,pumps=[types.SimpleNamespace(is_alive=lambda:pump_live)],grant=grant)
        closure=None if missing else dict(originalPopenPid=123,originalReturncode=code,scopeSha256=grant['sha256'])
        module=types.SimpleNamespace(hint_prepared_declarations=lambda *args:(calls.append('hint') or dict(cacheCreditUsed=False)))
        loader=types.SimpleNamespace(exec_module=lambda _:calls.append('load-pinned-source'))
        util=types.SimpleNamespace(spec_from_file_location=lambda *a:types.SimpleNamespace(loader=loader),module_from_spec=lambda _:module)
        def read(path,*args):
            if path.name=='acceptance-seed.json':return b'seed'
            if path.name=='config.json':return json.dumps(dict(privateQualificationRuntimes=dict(candidate=dict(distTreeSha256=checksum)),roleTopology=dict(candidate=dict(image=grant['scope']['image'],host='172.1.2.3')))).encode()
            return b'SABALAN_INSTALLED_PRISTINE '+json.dumps(data_result).encode()+b'\n'
        namespace=dict(check=prior.check,private_read=read,digest=lambda raw:hashlib.sha256(raw).hexdigest(),json=json,encoded=lambda value:json.dumps(value).encode(),MIB=1024**2,importlib=types.SimpleNamespace(util=util))
        exec(compile(ast.Module(body=[method],type_ignores=[]),'actual-pristine-method','exec'),namespace)
        owner=types.SimpleNamespace(root=Path('/fixture'),actors={},completed=set(),index=dict(database='fixture',oid=2),grant=lambda _:grant,environment=lambda *a:{},request_id=lambda _:'request',artifact=lambda name:(calls.append('sourcepin:'+name) or Path('/fixture')/name),wait_original=lambda *a:calls.append('wait'),close_native=lambda _: (calls.append('close-native') or closure),channel=types.SimpleNamespace(emit=lambda *a:calls.append('DONE')))
        def new(*args,**kwargs):
            owner.actors['pristine-performance']=value;value['output']=Path('/fixture/output');return value
        owner.new_process=new
        try:namespace['pristine_performance'](owner,dict(input=dict(seedSha256=hashlib.sha256(b'seed').hexdigest())))
        except (RuntimeError,TypeError) as error:return calls,error
        return calls,None

    def test_closed_actual_original_before_hint_done(self):
        calls,error=self.run_method();self.assertIsNone(error)
        self.assertLess(calls.index('close-native'),calls.index('hint'));self.assertLess(calls.index('hint'),calls.index('DONE'))

    def test_live_missing_nonzero_pumps_refuse_before_hint(self):
        for args in (dict(closed=False),dict(code=1),dict(pump_live=True),dict(missing=True)):
            with self.subTest(args=args):
                calls,error=self.run_method(**args);self.assertIsNotNone(error);self.assertNotIn('hint',calls);self.assertNotIn('DONE',calls)

    def test_still_short_fresh_migration_capacity_refuses(self):
        tree=ast.parse((D/'application-native-candidate-controller.fixture.py').read_text())
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='CandidateOwner')
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='capacity')
        authority=object()
        class Refused(Exception):
            def __init__(self,*args):self.args=args
        namespace=dict(resource=lambda:dict(memoryAvailable=383938560),CAPACITY=dict(migration=402653184),_OriginalCapacityRefusal=Refused,_CAPACITY_REFUSAL_AUTHORITY=authority)
        exec(compile(ast.Module(body=[method],type_ignores=[]),'actual-capacity','exec'),namespace)
        with self.assertRaises(Refused) as caught:namespace['capacity'](types.SimpleNamespace(),'migration')
        self.assertEqual(caught.exception.args[-1],402653184)

if __name__=='__main__': unittest.main()

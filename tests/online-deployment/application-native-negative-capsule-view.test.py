"""Behavior of the production readonly root probe with synthetic Linux metadata."""
import copy,importlib.util,os,stat,types,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('negative_view',Path(__file__).with_name('application-native-negative-capsule-acceptance.fixture.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

class ViewTests(unittest.TestCase):
    def setUp(self):
        self.stat=types.SimpleNamespace(st_dev=2112,st_ino=20,st_uid=0,st_gid=0,st_mode=stat.S_IFDIR|0o700,st_nlink=4,st_size=4096,st_mtime_ns=30,st_ctime_ns=30)
        self.expected=fixture.identity(self.stat);self.names=copy.copy(fixture.NAMES);self.symlink=False;self.closed=False;self.fd_reads=0
        self.lines=['100 90 0:1 /var/lib/docker/volumes/sabalanerp-local_online_runtime_acceptance/_data/'+fixture.SUBPATH+' /app/online-runtime-acceptance rw - ext4 /dev/root rw']
        for i,name in enumerate(fixture.NAMES):self.lines.append(str(101+i)+' 100 0:1 /var/lib/docker/volumes/sabalanerp-local_online_runtime_acceptance/_data/'+name+' /app/online-runtime-acceptance/'+name+' ro - ext4 /dev/root rw')
        outer=self
        class FakePath:
            def __init__(self,name):self.name=str(name)
            def __str__(self):return self.name
            def __eq__(self,other):return isinstance(other,FakePath)and self.name==other.name
            def __truediv__(self,name):return FakePath(self.name+'/'+name)
            def resolve(self,strict=True):return self
            def lstat(self):return outer.stat
            def is_symlink(self):return outer.symlink
            def read_text(self):return '\n'.join(outer.lines)
        fixture.Path=FakePath;fixture.ROOT=FakePath('/app/online-runtime-acceptance')
        # Synthetic Linux flags; Windows does not provide these directory flags.
        linux_flags=dict(O_RDONLY=0,O_DIRECTORY=65536,O_NOFOLLOW=131072,O_CLOEXEC=524288)
        def opened(path,flags):
            self.assertEqual(path,fixture.ROOT);self.assertEqual(flags,65536|131072|524288);return 5
        def fstat(fd):self.assertEqual(fd,5);self.fd_reads+=1;return self.stat
        fixture.os=types.SimpleNamespace(open=opened,fstat=fstat,listdir=lambda fd:self.names,close=lambda fd:setattr(self,'closed',True),**linux_flags)

    def check(self):return fixture.view(self.expected)
    def test_two_readonly_capsules_are_the_only_visible_children(self):
        directories,mounts=self.check();self.assertEqual(len(directories),2);self.assertEqual(len(mounts),3);self.assertTrue(self.closed);self.assertEqual(self.fd_reads,2)
    def test_unknown_child_is_not_filtered_out(self):
        self.names.append('unexpected-actor')
        with self.assertRaises(AssertionError):self.check()
        self.assertTrue(self.closed)
    def test_wrong_identity_refuses(self):
        self.expected['st_ino']='21'
        with self.assertRaises(AssertionError):self.check()
        self.assertTrue(self.closed)
    def test_child_alias_refuses(self):
        self.symlink=True
        with self.assertRaises(AssertionError):self.check()
    def test_wrong_mount_readonly_parent_or_scope_refuses(self):
        original=copy.copy(self.lines)
        for changed in [original[1].replace(' ro -',' rw -'),original[1].replace(' 100 ',' 99 ',1),original[1].replace('_data/application-prisma','_data/other/application-prisma'),original[0].replace(fixture.SUBPATH,'other'),original[0].replace(' rw -',' ro -')]:
            with self.subTest(line=changed):
                self.lines=copy.copy(original);self.lines[0 if changed.startswith('100 ')else 1]=changed
                with self.assertRaises(AssertionError):self.check()
    def test_missing_or_extra_mount_refuses(self):
        original=copy.copy(self.lines)
        for lines in [original[:2],original+[original[1]]]:
            self.lines=lines
            with self.assertRaises(AssertionError):self.check()

if __name__=='__main__':unittest.main()

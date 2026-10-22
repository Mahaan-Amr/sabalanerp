"""Exercise actual namespace creation and key provisioning on a POSIX memory FS."""
import ast,base64,importlib.util,stat,types,unittest
from pathlib import Path
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('authority_cohort',HERE/'application-native-authority-cohort.fixture.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Node:
 def __init__(self,ino,mode=stat.S_IFDIR|0o700,uid=0,data=b''):self.ino=ino;self.mode=mode;self.uid=uid;self.data=data;self.children={}
 def stat(self):return types.SimpleNamespace(st_dev=1,st_ino=self.ino,st_uid=self.uid,st_gid=0,st_mode=self.mode,st_nlink=2 if stat.S_ISDIR(self.mode)else 1,st_size=len(self.data),st_mtime_ns=1,st_ctime_ns=1)

class MemoryFS:
 def __init__(self):self.root=Node(1);self.fds={};self.nextino=2;self.readonly=False;self.synced=[]
 def mkdir(self,name,mode,dir_fd):
  parent=self.fds[dir_fd]
  if name in parent.children:raise FileExistsError(name)
  parent.children[name]=Node(self.nextino,stat.S_IFDIR|mode);self.nextino+=1
 def open(self,path,flags,dir_fd=None):
  node=path.node if isinstance(path,MemoryPath)else self.fds[dir_fd].children[path]
  if not stat.S_ISDIR(node.mode):raise OSError('NOFOLLOW_OR_NOT_DIRECTORY')
  fd=max(self.fds,default=0)+1;self.fds[fd]=node;return fd
 def os(self):return types.SimpleNamespace(O_RDONLY=0,O_DIRECTORY=1,O_NOFOLLOW=2,O_CLOEXEC=4,ST_RDONLY=1,open=self.open,close=lambda fd:self.fds.pop(fd),fstat=lambda fd:self.fds[fd].stat(),stat=lambda name,dir_fd,follow_symlinks:self.fds[dir_fd].children[name].stat(),listdir=lambda fd:list(self.fds[fd].children),mkdir=self.mkdir,fsync=lambda fd:self.synced.append(fd),statvfs=lambda p:types.SimpleNamespace(f_flag=int(self.readonly)))

class MemoryPath:
 def __init__(self,fs,node=None):self.fs=fs;self.node=node or fs.root
 def __str__(self):return '/volume'
 def __eq__(self,other):return self is other
 def resolve(self,strict=True):return self if not stat.S_ISLNK(self.node.mode)else object()
 def lstat(self):return self.node.stat()

class Cases(unittest.TestCase):
 def setUp(self):
  self.fs=MemoryFS();self.root=MemoryPath(self.fs);self.oldos,self.oldpath=m.os,m.Path;m.os=self.fs.os();m.Path=lambda p:types.SimpleNamespace(read_bytes=lambda:b'1 2 0:1 / /volume rw - tmpfs none rw\n')
 def tearDown(self):m.os=self.oldos;m.Path=self.oldpath
 def test_two_fresh_namespaces_preserve_old_key_and_foreign_consumer(self):
  old=Node(8,stat.S_IFREG|0o444,data=b'old-public-key');foreign=Node(9,stat.S_IFREG|0o400,data=b'foreign-grant');self.fs.root.children.update({'qualification-controller-public-key.pem':old,'foreign.json':foreign})
  a=m.create_namespace(self.root,'a'*32);b=m.create_namespace(self.root,'b'*32)
  self.assertNotEqual(a['st_ino'],b['st_ino']);self.assertEqual(self.fs.root.children['qualification-controller-public-key.pem'],old);self.assertEqual(old.data,b'old-public-key');self.assertIs(self.fs.root.children['foreign.json'],foreign);self.assertEqual(foreign.data,b'foreign-grant');self.assertGreaterEqual(len(self.fs.synced),4)
 def test_existing_empty_and_nonempty_namespace_never_adopted(self):
  m.create_namespace(self.root,'a'*32)
  with self.assertRaises(FileExistsError):m.create_namespace(self.root,'a'*32)
  self.fs.root.children['cohort-'+'a'*32].children['key']=Node(10,stat.S_IFREG|0o444,data=b'existing')
  with self.assertRaises(FileExistsError):m.create_namespace(self.root,'a'*32)
 def test_existing_symlink_or_foreign_namespace_refused(self):
  for mode,uid in [(stat.S_IFLNK|0o777,0),(stat.S_IFDIR|0o700,1000)]:
   self.fs.root.children['cohort-'+'c'*32]=Node(5,mode,uid)
   with self.assertRaises(FileExistsError):m.create_namespace(self.root,'c'*32)
 def test_foreign_or_symlink_parent_refused(self):
  for mode,uid in [(stat.S_IFLNK|0o777,0),(stat.S_IFDIR|0o700,1000),(stat.S_IFDIR|0o777,0)]:
   self.fs.root.mode,self.fs.root.uid=mode,uid
   with self.assertRaises(AssertionError):m.create_namespace(self.root,'d'*32)
 def test_readonly_mount_refuses_before_any_directory_creation(self):
  self.fs.readonly=True
  with self.assertRaisesRegex(AssertionError,'NOT_WRITABLE'):m.create_namespace(self.root,'d'*32)
  self.assertEqual(self.fs.root.children,{})
 def test_existing_root_read_permissions_are_preserved_and_child_is_private(self):
  self.fs.root.mode=stat.S_IFDIR|0o755;created=m.create_namespace(self.root,'e'*32)
  self.assertEqual(stat.S_IMODE(self.fs.root.mode),0o755);self.assertEqual(stat.S_IMODE(created['st_mode']),0o700)
 def test_unsafe_nonce_refused_before_mutation(self):
  for value in ['../escape','a/b','cohort-'+'a'*32,'']:
   with self.assertRaises(AssertionError):m.create_namespace(self.root,value)
  self.assertEqual(self.fs.root.children,{})
 def test_mounted_namespace_must_be_the_same_empty_prepared_inode(self):
  expected=m.create_namespace(self.root,'a'*32);target=MemoryPath(self.fs,self.fs.root.children['cohort-'+'a'*32])
  self.assertEqual(m.verify_namespace(self.root,'a'*32,expected,target),expected)
  target.node=Node(99)
  with self.assertRaisesRegex(AssertionError,'NAMESPACE_CHANGED'):m.verify_namespace(self.root,'a'*32,expected,target)
 def test_namespace_populated_between_prepare_and_mount_is_refused(self):
  expected=m.create_namespace(self.root,'a'*32);target=MemoryPath(self.fs,self.fs.root.children['cohort-'+'a'*32]);target.node.children['foreign-key']=Node(90,stat.S_IFREG|0o444,data=b'foreign')
  with self.assertRaisesRegex(AssertionError,'NAMESPACE_CHANGED'):m.verify_namespace(self.root,'a'*32,expected,target)

class ActualKeyProvisioning(unittest.TestCase):
 def test_actual_fixed_key_function_accepts_second_fresh_store_and_preserves_first(self):
  tree=ast.parse((HERE/'application-native.fixture.py').read_bytes());function=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='provision_private_qualification_public_key');files={}
  class P:
   def __init__(self,path):self.path=path
   def __truediv__(self,name):return P(self.path+'/'+name)
   def exists(self):return self.path in files
   def is_symlink(self):return False
   def lstat(self):return types.SimpleNamespace(st_mode=stat.S_IFREG|0o444,st_nlink=1,st_uid=0)
   def read_bytes(self):return files[self.path]
  def check(value,message):
   if not value:raise AssertionError(message)
  ns={'base64':base64,'stat':stat,'check':check,'write':lambda p,data,mode:files.update({p.path:data})};exec(compile(ast.Module(body=[function],type_ignores=[]),'actual-key-provision','exec'),ns)
  def config(byte):return {'originalHostEnrollment':{'publicKey':base64.b64encode(bytes.fromhex('302a300506032b6570032100')+bytes([byte])*32).decode()}}
  ns['provision_private_qualification_public_key'](P('/root/cohort-a'),config(1));first=dict(files)
  with self.assertRaisesRegex(AssertionError,'EXISTING_KEY_DIFFERENT'):ns['provision_private_qualification_public_key'](P('/root/cohort-a'),config(2))
  ns['provision_private_qualification_public_key'](P('/root/cohort-b'),config(2));self.assertEqual(files['/root/cohort-a/qualification-controller-public-key.pem'],first['/root/cohort-a/qualification-controller-public-key.pem']);self.assertNotEqual(files['/root/cohort-a/qualification-controller-public-key.pem'],files['/root/cohort-b/qualification-controller-public-key.pem'])
if __name__=='__main__':unittest.main()

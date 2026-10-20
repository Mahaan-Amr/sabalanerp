import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const privateFile='/etc/sabalan/online/release-controller-private-key.pem';
const publicDirectory='/opt/sabalanerp/.deploy-state/online-trust';
const publicFile=publicDirectory+'/release-controller-public-key.pem';
const controllerDirectories=['/opt/sabalanerp/.deploy-state/online-publications','/opt/sabalanerp/.deploy-state/online-edge-journals'];
const qualificationPublicFile='/etc/sabalan/online/qualification-public-key.pem';
const qualificationSource=fileURLToPath(new URL('../trust/online-qualification-public-key.pem',import.meta.url));
const qualificationPublicSha256='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48';
const mode=process.argv[2]??'--inspect';
if(process.argv.length>3||!['--inspect','--install'].includes(mode))throw Error('ONLINE_TRUST_INSTALL_MODE');
if(mode==='--inspect'){
 console.log(JSON.stringify({privateFile,publicFile,qualificationPublicFile,qualificationPublicSha256,controllerDirectories,privateKeyWrittenToTrustDirectory:false,rotatesExistingKey:false,
  requires:'original production deployment lock on inherited FD9',mutated:false}));
}else{
 if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('ONLINE_TRUST_ROOT_REQUIRED');
 // Same inherited open file description as the original deployment owner.
 const guard=spawnSync('/usr/bin/python3',['-I','-B','-c',String.raw`import os,stat,fcntl
p='/opt/sabalanerp/.deploy-state/deployment.lock'
n=os.lstat(p);f=os.fstat(9)
assert stat.S_ISREG(n.st_mode) and n.st_uid==0 and n.st_nlink==1 and not n.st_mode&0o022
assert (n.st_dev,n.st_ino)==(f.st_dev,f.st_ino)
fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
`],{stdio:['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',9],maxBuffer:16384});
 if(guard.error||guard.status!==0||guard.signal)throw Error('ONLINE_TRUST_ORIGINAL_LOCK_REQUIRED');
 const sync=directory=>{const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 function directory(value){
  if(value==='/')return;
  directory(path.dirname(value));
  if(!fs.existsSync(value)){fs.mkdirSync(value,{mode:0o700});sync(path.dirname(value));}
  const st=fs.lstatSync(value);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)||fs.realpathSync(value)!==value)throw Error('ONLINE_TRUST_UNSAFE_PARENT');
 }
 function read(file,expectedMode){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=fs.fstatSync(fd,{bigint:true});
   if(!before.isFile()||before.uid!==0n||before.nlink!==1n||(before.mode&0o777n)!==BigInt(expectedMode)||before.size<1n||before.size>4096n)throw Error('ONLINE_TRUST_UNSAFE_FILE');
   const data=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
   for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'])if(before[key]!==after[key]||before[key]!==named[key])throw Error('ONLINE_TRUST_FILE_CHANGED');
   return data;
  }finally{fs.closeSync(fd);}
 }
 function write(file,data,permissions){
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,data);fs.fchmodSync(fd,permissions);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  sync(path.dirname(file));
 }
 process.umask(0o077);
 directory(path.dirname(privateFile));directory(publicDirectory);
 for(const selected of controllerDirectories){
  directory(selected);
  if((fs.lstatSync(selected).mode&0o777)!==0o700)throw Error('ONLINE_TRUST_UNSAFE_CONTROLLER_DIRECTORY');
  sync(selected);
 }
 const qualificationRaw=fs.readFileSync(qualificationSource);
 if(createHash('sha256').update(qualificationRaw).digest('hex')!==qualificationPublicSha256||createPublicKey(qualificationRaw).asymmetricKeyType!=='ed25519')throw Error('ONLINE_QUALIFICATION_PUBLIC_SOURCE_CHANGED');
 if(!fs.existsSync(qualificationPublicFile))write(qualificationPublicFile,qualificationRaw,0o444);
 if(!read(qualificationPublicFile,0o444).equals(qualificationRaw))throw Error('ONLINE_QUALIFICATION_PUBLIC_KEY_CHANGED');
 const exists=fs.existsSync(privateFile);
 if(!exists&&fs.existsSync(publicFile))throw Error('ONLINE_TRUST_ORPHAN_PUBLIC_KEY');
 if(!exists){const keys=generateKeyPairSync('ed25519');write(privateFile,keys.privateKey.export({format:'pem',type:'pkcs8'}),0o600);}
 const key=createPrivateKey(read(privateFile,0o600));
 if(key.asymmetricKeyType!=='ed25519')throw Error('ONLINE_TRUST_KEY_TYPE');
 const publicBytes=Buffer.from(createPublicKey(key).export({format:'pem',type:'spki'}));
 if(!fs.existsSync(publicFile))write(publicFile,publicBytes,0o444);
 if(!read(publicFile,0o444).equals(publicBytes))throw Error('ONLINE_TRUST_KEY_PAIR_CHANGED');
 console.log(JSON.stringify({installed:true,qualificationPublicSha256,existingPrivateKeyReused:exists,publicSha256:createHash('sha256').update(publicBytes).digest('hex'),privateKeyWrittenToTrustDirectory:false,productionAdmission:false}));
}

'use strict';
// Canonical encryption of closed checkpoint components, never release/health
// authority. Original capture, WAL coverage and independent restore are separate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
const fingerprint = s => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].map(String).join(':');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const roles = new Set(['physical-base','coherent-cut','coverage-manifest','inquiry-sqlite','coordination','versioned-file-cut','versioned-file-object','versioned-file-lineage','wal-segment','wal-capture']);
let diagnosticStage='INITIAL';

function validateManifest(value, operation) {
  assert.equal(value.format, 'sabalan-online-checkpoint-plaintext-components/v1');
  assert.equal(value.operation, operation);
  assert.ok(digest(value.coverageSha256) && digest(value.sourceCaptureSha256));
  assert.ok(Array.isArray(value.sources) && value.sources.length >= 15 && value.sources.length <= 250000);
  const names = new Set(), files = new Set(), counts = new Map();
  for (const row of value.sources) {
    assert.deepEqual(Object.keys(row).sort(), ['bytes','name','path','role','sha256']);
    assert.ok(roles.has(row.role) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(row.name));
    assert.ok(!names.has(row.name) && !files.has(row.path)); names.add(row.name); files.add(row.path);
    assert.ok(typeof row.path === 'string' && path.isAbsolute(row.path) && !row.path.includes('\0'));
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 16 * 1024 ** 3 && digest(row.sha256));
    if (!['versioned-file-object','versioned-file-lineage'].includes(row.role)) assert.ok(row.bytes > 0);
    counts.set(row.role, (counts.get(row.role) || 0) + 1);
  }
  for (const role of ['physical-base','coherent-cut','coverage-manifest','inquiry-sqlite','coordination','wal-capture']) assert.equal(counts.get(role), 1);
  assert.equal(value.sources.find(row=>row.role==='coherent-cut').sha256,value.sourceCaptureSha256);
  assert.equal(value.sources.find(row=>row.role==='coverage-manifest').sha256,value.coverageSha256);
  assert.equal(counts.get('versioned-file-cut'), 9);
  assert.ok(counts.get('wal-segment') >= 1 && counts.get('wal-segment') <= 8);
  return value;
}

function openPrivate(file, maximum) {
  assert.equal(fs.realpathSync(file), file);
  const named = fs.lstatSync(file,{bigint:true});
  assert.ok(named.isFile() && named.nlink === 1n && named.uid === BigInt(process.getuid())
    && !(named.mode & 0o077n) && named.size >= 0n && named.size <= BigInt(maximum));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    diagnosticStage='CONFIGURATION';
    assert.equal(fingerprint(fs.fstatSync(fd,{bigint:true})), fingerprint(named));
    const verify = () => {
      assert.equal(fingerprint(fs.fstatSync(fd,{bigint:true})), fingerprint(named));
      assert.equal(fingerprint(fs.lstatSync(file,{bigint:true})), fingerprint(named));
    };
    return {fd,named,verify};
  } catch(error) { fs.closeSync(fd); throw error; }
}

function sync(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function save(file, value) {
  fs.writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o400});sync(file);sync(path.dirname(file));
}

async function main(argv=process.argv.slice(2)) {
  assert.equal(process.platform,'linux'); assert.equal(argv.length,2); process.umask(0o077);
  const [configurationFile,configurationSha256]=argv;assert.ok(digest(configurationSha256));
  const held=[];
  const read=(file,maximum)=>{
    const opened=openPrivate(file,maximum);held.push(opened);
    const raw=fs.readFileSync(opened.fd);opened.verify();fs.fsyncSync(opened.fd);return raw;
  };
  try {
    const raw=read(configurationFile,8*1024**2);assert.equal(sha(raw),configurationSha256);
    const config=JSON.parse(raw);
    assert.deepEqual(Object.keys(config).sort(),['componentManifestFile','componentManifestSha256','format','localKeyFile','lockFile','operation','publicKeyFile','root']);
    assert.equal(config.format,'sabalan-online-checkpoint-seal-input/v1');assert.match(config.operation,/^[a-f0-9]{64}$/);
    assert.equal(fs.realpathSync(config.root),config.root);
    const directory=fs.lstatSync(config.root);assert.ok(directory.isDirectory()&&directory.uid===process.getuid()&&!(directory.mode&0o077));
    const lock=fs.fstatSync(9,{bigint:true}),named=fs.lstatSync(config.lockFile,{bigint:true});
    assert.equal(fs.realpathSync(config.lockFile),config.lockFile);
    assert.ok(named.isFile()&&named.nlink===1n&&named.uid===BigInt(process.getuid())&&!(named.mode&0o022n)&&named.size===0n&&lock.dev===named.dev&&lock.ino===named.ino);
    assert.ok(fs.readFileSync('/proc/self/fdinfo/9','utf8').split('\n').some(line=>new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'+named.ino+'\\s+0\\s+EOF\\s*$').test(line)));
    diagnosticStage='MANIFEST';
    const manifestRaw=read(config.componentManifestFile,64*1024**2);assert.equal(sha(manifestRaw),config.componentManifestSha256);
    const manifest=validateManifest(JSON.parse(manifestRaw),config.operation);
    diagnosticStage='RECIPIENTS';
    const localKey=read(config.localKeyFile,65536).toString('utf8');assert.ok(localKey.length>=32);
    const publicKey=crypto.createPublicKey(read(config.publicKeyFile,65536));
    assert.equal(publicKey.asymmetricKeyType,'rsa');assert.ok(publicKey.asymmetricKeyDetails.modulusLength>=2048);
    const publicKeyPem=publicKey.export({type:'spki',format:'pem'}).toString();
    const independentPublicKeySha256=sha(publicKey.export({type:'spki',format:'der'}));
    const {encryptRecoveryArchiveForRecipients,decryptRecoveryArchive,sha256File}=require('/app/dist/services/recoveryCrypto');
    const output=path.join(config.root,'sealed-components');fs.mkdirSync(output,{mode:0o700});sync(config.root);
    const objects=[]; const aliases=new Set(held.map(file=>file.named.dev+':'+file.named.ino));
    save(path.join(output,'seal-intent.json'),{operation:config.operation,configurationSha256,manifestSha256:sha(manifestRaw),independentPublicKeySha256});
    for(const row of manifest.sources) {
      diagnosticStage='SOURCE_'+row.role.toUpperCase().replaceAll('-','_');
      const source=openPrivate(row.path,row.bytes);
      try {
        assert.equal(source.named.size,BigInt(row.bytes));
        const alias=source.named.dev+':'+source.named.ino;assert.ok(!aliases.has(alias));aliases.add(alias);
        assert.equal(await sha256File(row.path),row.sha256);source.verify();fs.fsyncSync(source.fd);
        const space=fs.statfsSync(output,{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(row.bytes)*2n+268435456n);
        const cipher=path.join(output,row.name+'.sabrec');
        diagnosticStage='ENCRYPT_'+row.role.toUpperCase().replaceAll('-','_');
        await encryptRecoveryArchiveForRecipients(row.path,cipher,[{keyId:'local-rollback',passphrase:localKey},{keyId:'independent-recovery',publicKeyPem}]);
        sync(cipher);source.verify();assert.equal(await sha256File(row.path),row.sha256);
        const roundtrip=cipher+'.local-check';
        diagnosticStage='ROUNDTRIP_'+row.role.toUpperCase().replaceAll('-','_');
        await decryptRecoveryArchive(cipher,roundtrip,localKey);
        assert.equal(fs.statSync(roundtrip).size,row.bytes);assert.equal(await sha256File(roundtrip),row.sha256);
        const closed=openPrivate(cipher,row.bytes+65536);
        try {
          objects.push({...row,cipherFile:cipher,cipherSha256:await sha256File(cipher),cipherBytes:Number(closed.named.size),localDecryptVerified:true});closed.verify();
        } finally {fs.closeSync(closed.fd);}
        fs.unlinkSync(roundtrip);sync(output);source.verify();
      } finally {fs.closeSync(source.fd);}
    }
    for(const file of held)file.verify();
    const result={format:'sabalan-online-checkpoint-components-sealed/v1',phase:'SEALED_LOCAL',operation:config.operation,
      configurationSha256,manifestSha256:sha(manifestRaw),independentPublicKeySha256,objects,
      independentDecryptVerified:false,remoteReadBackVerified:false,healthyRecoveryPoint:false,productionAdmission:false};
    const receiptFile=path.join(output,'sealed.json');save(receiptFile,result);
    process.stdout.write(JSON.stringify({format:result.format,phase:result.phase,operation:result.operation,
      receiptFile,receiptSha256:await sha256File(receiptFile),objects:objects.length,
      independentDecryptVerified:false,remoteReadBackVerified:false,healthyRecoveryPoint:false,productionAdmission:false})+'\n');return result;
  } finally {for(const file of held)fs.closeSync(file.fd);}
}
module.exports={validateManifest};
if(require.main===module)main().catch(error=>{process.stderr.write(JSON.stringify({code:'ONLINE_CHECKPOINT_SEAL_UNPROVEN',stage:diagnosticStage,
  failureClass:error.name,detail:/^[A-Z][A-Z0-9_]{1,119}$/.test(error.code||'')?error.code:null})+'\n');process.exitCode=1;});

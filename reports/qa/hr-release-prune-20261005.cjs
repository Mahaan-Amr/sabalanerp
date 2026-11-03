const fs = require('node:fs');
const path = require('node:path');
const { planLocalCheckpointCleanup } = require('/app/dist/services/deploymentCheckpointPolicy');
const { sha256File } = require('/app/dist/services/recoveryCrypto');
(async () => {
  const root = '/app/storage/recovery/packages';
  const proofs = JSON.parse(fs.readFileSync('/proof.json', 'utf8').replace(/^\uFEFF/, ''));
  const valid = new Map();
  for (const proof of proofs) {
    if (!/^deploy-[A-Za-z0-9-]+$/.test(proof.id) || !/^[a-f0-9]{64}$/.test(proof.checksum)
      || proof.verified !== true || !Number.isSafeInteger(proof.size) || proof.size <= 0
      || !Number.isFinite(Date.parse(proof.verifiedAt))
      || Math.abs(Date.now() - Date.parse(proof.verifiedAt)) > 3600000
      || !/^[DE]:[\\/]SabalanERP-Offsite-Recovery(?:-Archive)?[\\/]/.test(proof.archiveLocation)
      || proof.metadataLocation !== proof.archiveLocation + '.json') throw new Error('Invalid or stale off-server copy proof');
    if (valid.has(proof.id)) throw new Error('Duplicate proof');
    valid.set(proof.id, proof);
  }
  const inventory = [];
  for (const name of fs.readdirSync(root).filter(n => n.endsWith('.sabrec.json'))) {
    const metadataPath = path.join(root, name);
    const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const id = meta.deploymentId || meta.id;
    if (!/^deploy-[A-Za-z0-9-]+$/.test(id) || name !== id + '.sabrec.json') throw new Error('Unsafe metadata identity');
    const archivePath = path.join(root, id + '.sabrec');
    const proof = valid.get(id);
    const matches = proof && proof.checksum === meta.checksum && proof.size === fs.statSync(archivePath).size;
    inventory.push({id, createdAt: new Date(meta.createdAt), size: fs.statSync(archivePath).size,
      remoteVerified: Boolean(matches && meta.remoteVerified === true), active: meta.active === true,
      incidentOpen: meta.incidentOpen === true, checksum: meta.checksum, archivePath, metadataPath});
  }
  const stats = fs.statfsSync(root);
  const available = stats.bavail * stats.bsize;
  const plan = planLocalCheckpointCleanup({artifacts: inventory, bytesNeeded: Math.max(0, 8900000000 - available), minimumSuccessfulLocal: 2});
  if (!plan.sufficient) throw new Error('Eligible cleanup cannot provide required capacity');
  const protectedIds = ['deploy-20261004T131810Z-add179ec6ef6-release', 'deploy-20261004T093259Z-da5761153f44-release'];
  if (protectedIds.some(id => plan.deleteIds.includes(id) || !valid.has(id))) throw new Error('Latest rollback checkpoint protection failed');
  for (const id of plan.deleteIds) {
    const artifact = inventory.find(a => a.id === id);
    if (artifact.active || artifact.incidentOpen || !artifact.remoteVerified
      || !artifact.archivePath.startsWith(root + '/') || !artifact.metadataPath.startsWith(root + '/')) throw new Error('Protected or unsafe artifact');
    if (await sha256File(artifact.archivePath) !== artifact.checksum) throw new Error('Local archive checksum mismatch');
  }
  const auditPath = '/app/storage/recovery/audit/deployment-retention.jsonl';
  fs.mkdirSync(path.dirname(auditPath), {recursive: true});
  for (const id of plan.deleteIds) {
    const artifact = inventory.find(a => a.id === id);
    const proof = valid.get(id);
    const record = {at: new Date().toISOString(), id, size: artifact.size, checksum: artifact.checksum,
      reason: 'REMOTE_VERIFIED_RETENTION_PRUNE', verificationHost: 'off-server-storage-host',
      remoteCopyLocation: proof.archiveLocation, metadataCopyLocation: proof.metadataLocation, verifiedAt: proof.verifiedAt};
    fs.appendFileSync(auditPath, JSON.stringify({...record, result: 'DELETE_PLANNED'}) + '\n', {mode: 0o600});
    fs.unlinkSync(artifact.archivePath);
    fs.unlinkSync(artifact.metadataPath);
    fs.appendFileSync(auditPath, JSON.stringify({...record, result: 'DELETED'}) + '\n', {mode: 0o600});
    console.log('Verified retention removed ' + id);
  }
  const after = fs.statfsSync(root);
  console.log(JSON.stringify({availableBytes: after.bavail * after.bsize, removed: plan.deleteIds.length, retainedRollback: protectedIds}));
})().catch(error => { console.error(error.message); process.exit(1); });

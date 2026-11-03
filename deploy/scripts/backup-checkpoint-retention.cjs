"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// backend/src/scripts/backup-checkpoint-retention.ts
var import_strict2 = __toESM(require("node:assert/strict"));
var import_node_fs4 = __toESM(require("node:fs"));

// backend/src/services/deploymentCheckpointStorage.ts
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_path2 = __toESM(require("node:path"));
var import_node_crypto2 = require("node:crypto");

// backend/src/services/recoveryCrypto.ts
var MAGIC = Buffer.from("SABREC01");

// backend/src/services/onlineCheckpointDirectory.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_node_crypto = require("node:crypto");
var KEY = "/etc/sabalan/online/qualification-public-key.pem";
var KEY_SHA = "e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48";
var canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
var encode = (v) => Buffer.from(JSON.stringify(canonical(v)));
var sha = (raw) => (0, import_node_crypto.createHash)("sha256").update(raw).digest("hex");
var hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function need(v) {
  if (!v) throw Error("ONLINE_RECOVERY_DIRECTORY_UNPROVEN");
}
var equal = (a, b) => {
  if (a === void 0 || b === void 0) need(a === b);
  else need(encode(a).equals(encode(b)));
};
var pin = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.uid, s.mode, s.nlink].map(String).join(":");
var safeRelative = (v) => {
  need(typeof v === "string" && v.length <= 512 && !v.includes("\\") && !v.startsWith("/") && v.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== ".."));
  return v;
};
var originals = /* @__PURE__ */ new WeakMap();
function verifyOnlineRecoveryCertificate(raw, publicKey, domain, signedFormat, acceptedAt) {
  need(raw.length > 0 && raw.length <= 1024 * 1024);
  const envelope = JSON.parse(raw.toString("utf8")), d = envelope.decision;
  need(envelope.format === signedFormat && d?.format === domain && typeof envelope.signature === "string");
  const accepted = Date.parse(acceptedAt), issued = Date.parse(d.issuedAt), expires = Date.parse(d.expiresAt);
  need(Number.isFinite(accepted) && Number.isFinite(issued) && Number.isFinite(expires) && issued <= accepted && accepted < expires && expires - issued <= 6e5 && accepted <= Date.now());
  const signature = Buffer.from(envelope.signature, "base64"), key = (0, import_node_crypto.createPublicKey)(publicKey);
  need(signature.length === 64 && signature.toString("base64") === envelope.signature && key.asymmetricKeyType === "ed25519" && (0, import_node_crypto.verify)(null, Buffer.concat([Buffer.from(domain + "\n"), encode(d)]), key, signature));
  return d;
}
function verifyOnlineRecoveryImage(image) {
  const imageId = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  need(image && imageId(image.configImageId) && imageId(image.sourceImageId));
  need(image.archiveGraph && image.archiveGraph.config === image.configImageId && image.archiveGraph.index === image.sourceImageId);
}
var lsn = (value) => {
  need(typeof value === "string" && /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/.test(value));
  const [high, low] = value.split("/");
  return BigInt("0x" + high) << 32n | BigInt("0x" + low);
};
function windowNames(range) {
  need(Number.isSafeInteger(range.timeline) && range.timeline > 0 && range.timeline <= 4294967295 && Number.isSafeInteger(range.segmentBytes) && range.segmentBytes >= 1024 ** 2 && range.segmentBytes <= 1024 ** 3);
  const bytes = BigInt(range.segmentBytes);
  need((bytes & bytes - 1n) === 0n);
  const start = lsn(range.startLsn), end = lsn(range.endLsn);
  need(end > start);
  const first = start / bytes, last = (end - 1n) / bytes, perLog = 0x100000000n / bytes;
  need(last - first < 8n);
  const hex8 = (v) => v.toString(16).toUpperCase().padStart(8, "0");
  const names = [];
  for (let index = first; index <= last; index++) names.push(hex8(BigInt(range.timeline)) + hex8(index / perLog) + hex8(index % perLog));
  return names;
}
function verifyOnlineRecoveryWindow(dependency, input, publicKey) {
  const request = JSON.parse(input.requestRaw.toString()), seal = JSON.parse(input.sealRaw.toString()), capture = JSON.parse(input.captureRaw.toString());
  need(request.format === "sabalan-original-wal-window-verification-request/v1" && hex(request.challenge) && Number.isSafeInteger(request.sequence) && request.sequence > 0 && sha(encode(request)) === dependency.requestSha256);
  need(seal.format === "sabalan-wal-seal/v1" && seal.phase === "SEALED" && sha(input.sealRaw) === dependency.windowSha256 && request.windowSha256 === dependency.windowSha256 && seal.captureSha256 === sha(input.captureRaw));
  need(capture.phase === "COMPLETE" && capture.nativeReaped === true && capture.databaseQuiet === true && capture.nativeStatus === 0);
  equal(request.sourceIdentity, dependency.sourceIdentity);
  equal(request.sourceIdentity, { systemIdentifier: seal.source?.systemIdentifier, timeline: seal.source?.timeline });
  equal(seal.source, capture.source);
  equal(seal.range, { startLsn: capture.startLsn, endLsn: capture.endLsn, timeline: capture.source.timeline, segmentBytes: capture.source.segmentBytes });
  equal(request.deploymentId, dependency.deploymentId);
  equal(request.releaseId, dependency.releaseId);
  const names = windowNames(seal.range);
  need(Array.isArray(capture.segments) && capture.segments.length === names.length);
  equal(capture.segments.map((row) => row.name).sort(), [...names].sort());
  const rawObjects = [
    { name: "capture.sabrec", rawBytes: input.captureRaw.length, rawSha256: sha(input.captureRaw) },
    ...capture.segments.map((row) => {
      need(row.bytes === seal.range.segmentBytes && hex(row.sha256));
      return { name: row.name + ".sabrec", rawBytes: row.bytes, rawSha256: row.sha256 };
    })
  ];
  need(Array.isArray(seal.objects) && seal.objects.length === rawObjects.length && seal.objects.length <= 9);
  const objects = seal.objects.map((row, index) => {
    const raw = rawObjects[index];
    need(row.name === raw.name && row.rawBytes === raw.rawBytes && row.rawSha256 === raw.rawSha256 && row.localDecryptVerified === true && hex(row.encryptedSha256) && Number.isSafeInteger(row.encryptedBytes) && row.encryptedBytes > row.rawBytes && row.encryptedBytes <= 64 * 1024 ** 2);
    return { name: row.name, bytes: row.encryptedBytes, sha256: row.encryptedSha256 };
  });
  need(objects.reduce((total, row) => total + row.bytes, 0) <= 256 * 1024 ** 2);
  equal(request.objects, objects);
  equal(dependency.objects, objects.map((row) => ({ ...row, relativePath: "ciphertexts/" + row.name })));
  need(dependency.certificateFile === "certificate.json" && dependency.certificateSha256 === sha(input.certificateRaw));
  const decision = verifyOnlineRecoveryCertificate(input.certificateRaw, publicKey, "sabalan-original-wal-window-verification/v1", "sabalan-signed-original-wal-window-verification/v1", dependency.certificateAcceptedAt);
  for (const field of ["challenge", "windowSha256", "sourceIdentity", "objects"]) equal(decision[field], request[field]);
  need(decision.requestSha256 === dependency.requestSha256 && hex(decision.independentTokenSha256));
  return { requestSha256: dependency.requestSha256, windowSha256: dependency.windowSha256, certificateSha256: dependency.certificateSha256 };
}
function verifyOnlineInitialWalWindows(references, bindings, captureId) {
  need(Array.isArray(references));
  const seen = /* @__PURE__ */ new Set();
  for (const reference of references) {
    need(hex(reference.requestSha256) && !seen.has(reference.requestSha256));
    seen.add(reference.requestSha256);
    const row = bindings.find((value) => value.requestSha256 === reference.requestSha256);
    need(row);
    need(reference.relativeDirectory === "wal-windows/" + row.requestSha256 && reference.file === "/srv/sabalanerp-recovery/checkpoints/online-" + captureId + "/" + reference.relativeDirectory + "/dependency.json" && reference.sha256 === row.dependencySha256 && reference.originalDependencySha256 === row.originalDependencySha256 && reference.certificateSha256 === row.certificateSha256);
  }
}
function verifyOnlineRecoveryTerminal(raw, decision, point, dependencies) {
  need(sha(raw) === decision.terminalResultSha256);
  const terminal = JSON.parse(raw.toString());
  need(terminal.format === "sabalan-original-terminal-wal-coverage/v1" && terminal.phase === "COMPLETE" && terminal.captureId === point.captureId && terminal.ownedChildrenDomain === "continuous-wal-producer" && terminal.allOriginalChildrenClosed === true && terminal.replicationAuthenticationRestored === true && terminal.finalIntervalCompletion === true && ["ONLINE_SERVING", "ONLINE_ROLLBACK_PUBLISHING"].includes(terminal.terminalPhase));
  equal({ name: terminal.source?.databaseName, oid: terminal.source?.databaseOid, systemIdentifier: terminal.source?.systemIdentifier }, point.sourceDatabase);
  need(terminal.terminalEpochSha256 === decision.terminalEpochSha256 && terminal.publicationSha256 === decision.publicationSha256);
  need(Array.isArray(terminal.windows) && terminal.windows.length === dependencies.length && terminal.windows.length > 0);
  const seen = /* @__PURE__ */ new Set();
  let through;
  for (const window of terminal.windows) {
    need(hex(window.requestSha256) && !seen.has(window.requestSha256));
    seen.add(window.requestSha256);
    const dependency = dependencies.find((row) => row.requestSha256 === window.requestSha256);
    need(dependency);
    need(dependency.windowSha256 === window.windowSha256 && dependency.certificateSha256 === window.certificateSha256);
    const start = lsn(window.startLsn), end = lsn(window.endLsn);
    need(end > start && (through === void 0 || start <= through && end > through));
    through = end;
  }
  need(terminal.coveredFromLsn === terminal.windows[0].startLsn && terminal.coveredThroughLsn === terminal.windows[terminal.windows.length - 1].endLsn && lsn(terminal.coveredFromLsn) <= lsn(point.restorePoint.lsn) && lsn(terminal.coveredThroughLsn) >= lsn(terminal.terminalLsn));
  equal([...decision.windows].sort((a, b) => a.requestSha256.localeCompare(b.requestSha256)), dependencies.map(({ requestSha256, dependencySha256 }) => ({ requestSha256, dependencySha256 })).sort((a, b) => a.requestSha256.localeCompare(b.requestSha256)));
  return terminal;
}
async function readOriginal(file, maximum, collect = false) {
  need(await import_node_fs.default.promises.realpath(file) === file);
  const handle = await import_node_fs.default.promises.open(file, import_node_fs.default.constants.O_RDONLY | import_node_fs.default.constants.O_NOFOLLOW | import_node_fs.default.constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && (before.mode & 0o022n) === 0n && before.size >= 0n && before.size <= BigInt(maximum));
    const hash = (0, import_node_crypto.createHash)("sha256"), chunks = [], chunk = Buffer.allocUnsafe(256 * 1024);
    let bytes = 0;
    for (; ; ) {
      const result = await handle.read(chunk, 0, chunk.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      need(bytes <= maximum);
      const data = chunk.subarray(0, result.bytesRead);
      hash.update(data);
      if (collect) chunks.push(Buffer.from(data));
      await new Promise((resolve) => setImmediate(resolve));
    }
    need(BigInt(bytes) === before.size && pin(before) === pin(await handle.stat({ bigint: true })) && pin(before) === pin(await import_node_fs.default.promises.lstat(file, { bigint: true })));
    return { pin: pin(before), bytes, sha256: hash.digest("hex"), raw: collect ? Buffer.concat(chunks) : void 0 };
  } finally {
    await handle.close();
  }
}
async function readOnlineCheckpointDirectory(repositoryRoot, directory) {
  need(process.platform === "linux");
  const root = await import_node_fs.default.promises.realpath(repositoryRoot), absolute = import_node_path.default.resolve(directory);
  need(import_node_path.default.dirname(absolute) === root && /^online-[a-f0-9]{64}$/.test(import_node_path.default.basename(absolute)) && await import_node_fs.default.promises.realpath(absolute) === absolute);
  const key = await readOriginal(KEY, 4096, true);
  need(key.sha256 === KEY_SHA);
  const files = /* @__PURE__ */ new Map(), directories = /* @__PURE__ */ new Map();
  const read = async (relative, maximum = 8 * 1024 ** 2, expected, json = false) => {
    safeRelative(relative);
    need(!files.has(relative));
    const value = await readOriginal(import_node_path.default.join(absolute, ...relative.split("/")), maximum, json);
    if (expected) need(value.sha256 === expected.sha256 && (expected.bytes === void 0 || value.bytes === expected.bytes));
    files.set(relative, { pin: value.pin, bytes: value.bytes, sha256: value.sha256 });
    return json ? JSON.parse(value.raw.toString("utf8")) : value;
  };
  const point = await read("point.json", void 0, void 0, true);
  need(point.format === "sabalan-online-recovery-point/v1" && point.captureId === import_node_path.default.basename(absolute).slice(7));
  const certification = await read("certification.json", 1024 * 1024, void 0, true);
  need(certification.format === "sabalan-online-recovery-point-certification/v1" && certification.pointIndexSha256 === files.get("point.json").sha256 && certification.materialIndexSha256 === point.materialIndexSha256 && certification.canonicalMetadataSha256 === point.canonicalMetadataSha256);
  need(point.materialIndexFile === "recovery-material.json" && point.canonicalMetadataFile === "canonical-checkpoint.json");
  const material = await read(point.materialIndexFile, void 0, { sha256: point.materialIndexSha256 }, true);
  need(material.format === "sabalan-online-recovery-material/v1");
  for (const field of ["captureId", "sealedManifestSha256", "plaintextManifestSha256", "cipherInventorySha256", "physicalCompletionSha256", "physicalReportSha256", "sourceDatabase", "restorePoint", "objects", "images", "custodyFile", "custodySha256", "initialWalWindows"]) equal(point[field], material[field]);
  const envelope = await read(point.canonicalMetadataFile, void 0, { sha256: point.canonicalMetadataFileSha256 }, true);
  const metadata = envelope.canonicalMetadata;
  need(metadata && sha(encode(metadata)) === point.canonicalMetadataSha256 && envelope.canonicalMetadataSha256 === point.canonicalMetadataSha256);
  for (const [k, v] of Object.entries(metadata)) equal(envelope[k], v);
  need(metadata.captureMethod === "ONLINE_COHERENT_WAL" && typeof metadata.id === "string" && metadata.id.length > 0 && typeof metadata.releaseId === "string" && metadata.releaseId.length > 0 && Number.isFinite(Date.parse(metadata.createdAt)) && metadata.checksum === point.cipherInventorySha256 && metadata.remoteVerified === true && metadata.independentRestoreVerified === true);
  need(Number.isSafeInteger(metadata.size) && metadata.size > 0 && hex(metadata.sourceMachineUuidSha256) && hex(metadata.sourceKernelBootIdSha256));
  const repository = metadata.repositoryDirectory;
  need(repository?.format === "sabalan-online-checkpoint-directory/v1" && repository.captureId === point.captureId && repository.repository === "independent-recovery" && repository.mountPath === "/mnt/sabalanerp-independent-recovery/online-" + point.captureId && repository.sftpPath === "/checkpoints/online-" + point.captureId && repository.materialIndexSha256 === point.materialIndexSha256 && metadata.remotePath === repository.mountPath);
  for (const field of ["sealedManifestSha256", "plaintextManifestSha256", "cipherInventorySha256"]) need(hex(point[field]) && repository[field] === point[field]);
  equal(metadata.sourceDatabase, point.sourceDatabase);
  equal(metadata.physicalPoint, {
    sealedManifestSha256: point.sealedManifestSha256,
    plaintextManifestSha256: point.plaintextManifestSha256,
    cipherInventorySha256: point.cipherInventorySha256,
    restorePoint: point.restorePoint
  });
  const specs = [
    ["physical", "physical-verification.json", "sabalan-original-physical-checkpoint-verification/v1", "sabalan-signed-physical-checkpoint-verification/v1"],
    ["repository", "repository-promotion.json", "sabalan-original-physical-repository-promotion/v1", "sabalan-signed-physical-repository-promotion/v1"],
    ["metadataPublication", "publication-verification.json", "sabalan-original-physical-checkpoint-publication/v1", "sabalan-signed-physical-checkpoint-publication/v1"]
  ];
  const decisions = {};
  for (const [role, filename, domain, format] of specs) {
    const reference = certification.certificates?.[role];
    need(reference?.relativePath === filename && hex(reference.sha256));
    await read(filename, 1024 * 1024, { sha256: reference.sha256 });
    const raw = await readOriginal(import_node_path.default.join(absolute, filename), 1024 * 1024, true);
    need(raw.sha256 === reference.sha256);
    decisions[role] = verifyOnlineRecoveryCertificate(raw.raw, key.raw, domain, format, reference.acceptedAt);
  }
  const physical = decisions.physical, promotion = decisions.repository, publication = decisions.metadataPublication;
  for (const field of ["sealedManifestSha256", "plaintextManifestSha256", "cipherInventorySha256"]) need(physical[field] === point[field]);
  need(physical.reportSha256 === point.physicalReportSha256 && physical.originalCompletionSha256 === point.physicalCompletionSha256 && physical.continuousWalQualified === false && physical.productionAdmission === false);
  equal(physical.sourceDatabase, point.sourceDatabase);
  equal(physical.restorePoint, point.restorePoint);
  for (const d of [promotion, publication]) {
    equal(d.repository, repository);
    need(d.physicalCompletionSha256 === point.physicalCompletionSha256);
  }
  need(promotion.originalPromotionSha256 === metadata.repositoryPromotionSha256 && publication.canonicalMetadataSha256 === point.canonicalMetadataSha256 && publication.remoteMetadataSha256 === point.canonicalMetadataFileSha256 && publication.remoteMetadataFile === "/srv/sabalanerp-recovery/checkpoints/online-" + point.captureId + "/canonical-checkpoint.json");
  need(Array.isArray(point.objects) && point.objects.length >= 15 && point.objects.length <= 8192 + 32);
  for (const object of point.objects) {
    need(hex(object.sha256) && Number.isSafeInteger(object.bytes) && object.bytes > 0 && object.bytes <= 4 * 1024 ** 3);
    await read(object.relativePath, object.bytes, object);
  }
  const reports = point.objects.filter((row) => row.kind === "PHYSICAL_REPORT");
  need(reports.length === 1);
  const reportRaw = await readOriginal(import_node_path.default.join(absolute, safeRelative(reports[0].relativePath)), 32 * 1024 ** 2, true);
  need(reportRaw.sha256 === point.physicalReportSha256);
  const report = JSON.parse(reportRaw.raw.toString());
  need(report.format === "sabalan-original-independent-online-physical-restore/v1" && report.pass === true && report.physicalAndThreeApplicationsQualified === true && report.continuousWalQualified === false && report.sourceMachineUuidSha256 === metadata.sourceMachineUuidSha256 && report.sourceKernelBootIdSha256 === metadata.sourceKernelBootIdSha256 && hex(report.recoveryMachineUuidSha256) && report.recoveryMachineUuidSha256 !== report.sourceMachineUuidSha256 && hex(report.recoveryKernelBootIdSha256) && report.recoveryKernelBootIdSha256 !== report.sourceKernelBootIdSha256);
  equal(report.sourceDatabase, point.sourceDatabase);
  equal(report.restorePoint, point.restorePoint);
  need(point.custodyFile === "publication-custody.json" && hex(point.custodySha256));
  if (files.has(point.custodyFile)) need(files.get(point.custodyFile).sha256 === point.custodySha256);
  else await read(point.custodyFile, void 0, { sha256: point.custodySha256 });
  for (const role of ["backend", "frontend", "inquiry"]) {
    const image = point.images?.[role];
    verifyOnlineRecoveryImage(image);
    need(files.get(image.cipherRelativePath)?.sha256 === image.cipherSha256 && files.get(image.cipherRelativePath)?.bytes === image.cipherBytes && files.get(image.archiveReceiptRelativePath)?.sha256 === image.archiveReceiptSha256);
  }
  const walParent = import_node_path.default.join(absolute, "wal-windows"), windows = [], windowBindings = [];
  const readAgain = async (relative, maximum) => {
    const old = files.get(relative);
    need(old);
    const value = await readOriginal(import_node_path.default.join(absolute, safeRelative(relative)), maximum, true);
    need(value.pin === old.pin && value.sha256 === old.sha256 && value.bytes === old.bytes);
    return value.raw;
  };
  need(point.walWindowDirectory === "wal-windows");
  for (const entry of await import_node_fs.default.promises.readdir(walParent, { withFileTypes: true })) {
    need(entry.isDirectory() && hex(entry.name));
    const prefix = "wal-windows/" + entry.name + "/";
    const dependency = await read(prefix + "dependency.json", void 0, void 0, true);
    need(dependency.format === "sabalan-online-certified-wal-dependency/v1" && dependency.requestSha256 === entry.name && dependency.basePoint?.sealedManifestSha256 === point.sealedManifestSha256 && dependency.basePoint?.plaintextManifestSha256 === point.plaintextManifestSha256 && dependency.basePoint?.cipherInventorySha256 === point.cipherInventorySha256 && dependency.deploymentId === metadata.deploymentId && dependency.releaseId === metadata.releaseId);
    need(Array.isArray(dependency.files) && Array.isArray(dependency.objects));
    for (const row2 of [...dependency.files, ...dependency.objects]) {
      need(hex(row2.sha256) && Number.isSafeInteger(row2.bytes) && row2.bytes >= 0 && row2.bytes <= 1024 ** 3);
      await read(prefix + safeRelative(row2.relativePath), row2.bytes, row2);
    }
    for (const [file, checksum] of [[dependency.originalDependencyFile, dependency.originalDependencySha256], [dependency.custodyFile, dependency.custodySha256]]) {
      need(hex(checksum));
      if (files.has(prefix + file)) need(files.get(prefix + file).sha256 === checksum);
      else await read(prefix + safeRelative(file), void 0, { sha256: checksum });
    }
    need(dependency.certificateFile === "certificate.json" && files.get(prefix + "certificate.json")?.sha256 === dependency.certificateSha256);
    verifyOnlineRecoveryWindow(dependency, { requestRaw: await readAgain(prefix + "request.json", 1024 * 1024), sealRaw: await readAgain(prefix + "seal.json", 1024 * 1024), captureRaw: await readAgain(prefix + "capture.json", 1024 * 1024), certificateRaw: await readAgain(prefix + "certificate.json", 1024 * 1024) }, key.raw);
    const row = { requestSha256: entry.name, dependencySha256: files.get(prefix + "dependency.json").sha256 };
    windows.push(row);
    windowBindings.push({ ...row, windowSha256: dependency.windowSha256, certificateSha256: dependency.certificateSha256, originalDependencySha256: dependency.originalDependencySha256 });
  }
  verifyOnlineInitialWalWindows(point.initialWalWindows, windowBindings, point.captureId);
  let terminal = false;
  try {
    const terminalRaw = await readOriginal(import_node_path.default.join(absolute, "terminal-coverage.json"), 2 * 1024 ** 2, true);
    const accepted = JSON.parse(terminalRaw.raw.toString());
    need(accepted.format === "sabalan-accepted-online-terminal-coverage/v1");
    const d = verifyOnlineRecoveryCertificate(encode(accepted.envelope), key.raw, "sabalan-original-online-terminal-coverage/v1", "sabalan-signed-online-terminal-coverage/v1", accepted.acceptedAt);
    need(d.captureId === point.captureId && d.pointIndexSha256 === files.get("point.json").sha256 && d.canonicalMetadataSha256 === point.canonicalMetadataSha256 && hex(d.terminalResultSha256) && hex(d.terminalEpochSha256) && hex(d.publicationSha256));
    equal(d.sourceDatabase, point.sourceDatabase);
    const terminalResultRaw = await readOriginal(import_node_path.default.join(absolute, "terminal-result.json"), 4 * 1024 ** 2, true);
    need(terminalResultRaw.sha256 === d.terminalResultSha256);
    verifyOnlineRecoveryTerminal(terminalResultRaw.raw, d, point, windowBindings);
    files.set("terminal-result.json", { pin: terminalResultRaw.pin, bytes: terminalResultRaw.bytes, sha256: terminalResultRaw.sha256 });
    equal([...d.windows].sort((a, b) => a.requestSha256.localeCompare(b.requestSha256)), windows.sort((a, b) => a.requestSha256.localeCompare(b.requestSha256)));
    files.set("terminal-coverage.json", { pin: terminalRaw.pin, bytes: terminalRaw.bytes, sha256: terminalRaw.sha256 });
    terminal = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const inventory = async (folder, relative = "") => {
    const stat = await import_node_fs.default.promises.lstat(folder, { bigint: true });
    need(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o022n) === 0n);
    directories.set(relative, pin(stat));
    for (const entry of await import_node_fs.default.promises.readdir(folder, { withFileTypes: true })) {
      const name = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        need([...files.keys()].some((file) => file.startsWith(name + "/")) || name === "wal-windows");
        await inventory(import_node_path.default.join(folder, entry.name), name);
      } else need(entry.isFile() && !entry.isSymbolicLink() && files.has(name));
    }
  };
  await inventory(absolute);
  const evidence = Object.freeze({ format: "sabalan-verified-online-directory/v1" });
  originals.set(evidence, { root: absolute, files, directories, metadata, terminal, pointIndexSha256: files.get("point.json").sha256 });
  await assertOnlineCheckpointDirectoryUnchanged(evidence);
  return { metadata, metadataPath: import_node_path.default.join(absolute, point.canonicalMetadataFile), directory: absolute, evidence };
}
function hasHealthyOnlineDirectory(evidence, artifact) {
  const state = evidence && typeof evidence === "object" ? originals.get(evidence) : void 0;
  return !!state && ["id", "releaseId", "checksum", "size"].every((field) => state.metadata[field] === artifact[field]);
}
function canRetireOnlineDirectory(evidence) {
  return !!(evidence && typeof evidence === "object" && originals.get(evidence)?.terminal);
}
async function assertOnlineCheckpointDirectoryUnchanged(evidence) {
  const state = originals.get(evidence);
  need(state);
  for (const [relative, expected] of state.directories) need(pin(await import_node_fs.default.promises.lstat(import_node_path.default.join(state.root, relative), { bigint: true })) === expected);
  for (const [relative, expected] of state.files) {
    const actual = await readOriginal(import_node_path.default.join(state.root, relative), expected.bytes);
    need(actual.pin === expected.pin && actual.bytes === expected.bytes && actual.sha256 === expected.sha256);
  }
}
async function removeVerifiedOnlineCheckpointDirectory(evidence) {
  const state = originals.get(evidence);
  need(state?.terminal);
  await assertOnlineCheckpointDirectoryUnchanged(evidence);
  for (const relative of [...state.files.keys()].sort((a, b) => Number(a === "point.json") - Number(b === "point.json"))) {
    const file = import_node_path.default.join(state.root, relative);
    need(pin(await import_node_fs.default.promises.lstat(file, { bigint: true })) === state.files.get(relative).pin);
    await import_node_fs.default.promises.unlink(file);
  }
  for (const relative of [...state.directories.keys()].sort((a, b) => b.length - a.length)) await import_node_fs.default.promises.rmdir(import_node_path.default.join(state.root, relative));
}

// backend/src/services/deploymentCheckpointPolicy.ts
var hasHealthyIndependentCheckpointDrill = (artifact) => {
  const drill = artifact.lastDrill;
  const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (!drill || drill.format !== "sabalan-independent-checkpoint-drill/v1" || drill.status !== "HEALTHY" || drill.phase !== "COMPLETE" || drill.packageType !== "COMPLETE" || drill.checkpointId !== artifact.id || drill.releaseId !== artifact.releaseId || !digest(artifact.checksum) || drill.checksum !== artifact.checksum || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || drill.size !== artifact.size || !digest(artifact.sourceMachineUuidSha256) || drill.sourceMachineUuidSha256 !== artifact.sourceMachineUuidSha256 || !digest(drill.recoveryMachineUuidSha256) || drill.recoveryMachineUuidSha256 === drill.sourceMachineUuidSha256 || !digest(artifact.sourceKernelBootIdSha256) || drill.sourceKernelBootIdSha256 !== artifact.sourceKernelBootIdSha256 || !digest(drill.recoveryKernelBootIdSha256) || drill.recoveryKernelBootIdSha256 === drill.sourceKernelBootIdSha256 || typeof drill.operationId !== "string" || !drill.operationId.startsWith(`drill-${artifact.id}-`) || !/^\d+$/.test(drill.operationId.slice(`drill-${artifact.id}-`.length)) || !drill.startedAt || !drill.completedAt || !Number.isFinite(Date.parse(drill.startedAt)) || !Number.isFinite(Date.parse(drill.completedAt)) || Date.parse(drill.completedAt) < Date.parse(drill.startedAt)) return false;
  return drill.stagedPostgresRestore === true && drill.stagedSqliteIntegrity === true && drill.verifiedFiles === true && drill.verifiedApplicationPayloads === true && drill.verifiedBusinessData === true;
};
var hasHealthyRemoteRecoveryPoint = (artifact) => artifact.onlineDirectoryEvidence ? hasHealthyOnlineDirectory(artifact.onlineDirectoryEvidence, artifact) : hasHealthyIndependentCheckpointDrill(artifact);
var planRemoteCheckpointRetention = (artifacts) => {
  const verified = artifacts.filter((artifact) => artifact.remoteVerified && hasHealthyRemoteRecoveryPoint(artifact) && Number.isFinite(artifact.createdAt.getTime())).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
  const keep = new Set(verified.slice(0, 2).map((artifact) => artifact.id));
  for (const artifact of artifacts) {
    if (artifact.active || artifact.incidentOpen || !artifact.remoteVerified || !hasHealthyRemoteRecoveryPoint(artifact) || artifact.onlineDirectoryEvidence && !canRetireOnlineDirectory(artifact.onlineDirectoryEvidence) || !Number.isFinite(artifact.createdAt.getTime()) || verified.length < 2) keep.add(artifact.id);
  }
  return {
    keepIds: [...keep],
    deleteIds: verified.filter((artifact) => !keep.has(artifact.id)).map((artifact) => artifact.id)
  };
};

// backend/src/services/deploymentCheckpointStorage.ts
var remoteCheckpointChecksum = async (filePath) => {
  const hash = (0, import_node_crypto2.createHash)("sha256");
  for await (const chunk of import_node_fs2.default.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};
var readRemoteCheckpointFingerprint = async (remotePath) => {
  const stat = await import_node_fs2.default.promises.stat(remotePath);
  if (!stat.isFile()) throw Object.assign(new Error("Remote checkpoint is not a regular file."), { code: "DEPLOYMENT_REMOTE_OBJECT_INVALID" });
  return { size: stat.size, mtimeMs: stat.mtimeMs };
};
var assertRemoteCheckpointFingerprint = async (remotePath, expected) => {
  if (!expected || !Number.isFinite(expected.size) || !Number.isFinite(expected.mtimeMs)) {
    throw Object.assign(new Error("Remote checkpoint fingerprint is missing."), { code: "DEPLOYMENT_REMOTE_FINGERPRINT_MISSING" });
  }
  const actual = await readRemoteCheckpointFingerprint(remotePath);
  if (actual.size !== expected.size || actual.mtimeMs !== expected.mtimeMs) {
    throw Object.assign(new Error("Remote checkpoint fingerprint changed after pre-mutation verification."), {
      code: "DEPLOYMENT_REMOTE_FINGERPRINT_MISMATCH"
    });
  }
  return actual;
};
var findMetadataFiles = async (root) => {
  const entries = await import_node_fs2.default.promises.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = import_node_path2.default.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("DEPLOYMENT_RETENTION_INVENTORY_UNSAFE");
    if (entry.isDirectory()) files.push(...await findMetadataFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".sabrec.json")) files.push(absolute);
  }
  return files;
};
var appendRetentionAudit = async (root, entry) => {
  const handle = await import_node_fs2.default.promises.open(import_node_path2.default.join(root, "retention-audit.jsonl"), "a", 384);
  try {
    await handle.writeFile(`${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...entry })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
};
var hasRetentionEvent = async (root, artifact, event) => {
  let bytes;
  try {
    bytes = await import_node_fs2.default.promises.readFile(import_node_path2.default.join(root, "retention-audit.jsonl"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  return bytes.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).some((entry) => entry.id === artifact.id && entry.checksum === artifact.checksum && entry.event === event);
};
var checkpointArchivePresent = async (root, file, artifact) => {
  if (!import_node_path2.default.resolve(file).startsWith(`${root}${import_node_path2.default.sep}`)) throw new Error("DEPLOYMENT_RETENTION_PATH_UNSAFE");
  const parent = await import_node_fs2.default.promises.realpath(import_node_path2.default.dirname(file));
  if (parent !== root && !parent.startsWith(`${root}${import_node_path2.default.sep}`)) throw new Error("DEPLOYMENT_RETENTION_PATH_UNSAFE");
  try {
    const stat = await import_node_fs2.default.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("DEPLOYMENT_RETENTION_PATH_UNSAFE");
    return true;
  } catch (error) {
    if (error.code !== "ENOENT" || !await hasRetentionEvent(root, artifact, "RETENTION_INTENT")) throw error;
    return false;
  }
};
var enforceFilesystemRemoteRetention = async (root, activeDeploymentId, localRoot, options = {}) => {
  const localHolds = new Set(options.protectedCheckpointIds ?? []);
  const localEvidence = /* @__PURE__ */ new Map();
  if (localRoot) {
    for (const file of await findMetadataFiles(localRoot)) {
      const bytes = await import_node_fs2.default.promises.readFile(file, "utf8");
      localEvidence.set(file, bytes);
      const metadata = JSON.parse(bytes);
      if (!metadata.id) throw new Error("DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_INVALID");
      if (metadata.active || metadata.incidentOpen) localHolds.add(metadata.id);
    }
  }
  const inventory = [];
  const metadataSnapshots = /* @__PURE__ */ new Map();
  for (const metadataPath of await findMetadataFiles(root)) {
    try {
      const contents = await import_node_fs2.default.promises.readFile(metadataPath, "utf8");
      const metadata = JSON.parse(contents);
      if (metadata.id && metadata.releaseId && metadata.remotePath && metadata.remoteVerified && Number.isFinite(new Date(metadata.createdAt).getTime())) {
        const relative = import_node_path2.default.relative(root, metadataPath).slice(0, -5);
        if (!metadataPath.endsWith(".sabrec.json") || import_node_path2.default.basename(metadata.remotePath) !== import_node_path2.default.basename(relative) || relative.startsWith("..") || import_node_path2.default.isAbsolute(relative)) throw new Error("DEPLOYMENT_RETENTION_PATH_UNSAFE");
        const archivePath = import_node_path2.default.join(root, relative);
        inventory.push({ ...metadata, metadataPath, remotePath: archivePath, archivePath });
        metadataSnapshots.set(metadataPath, contents);
      }
    } catch {
    }
  }
  for (const entry of await import_node_fs2.default.promises.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^online-[a-f0-9]{64}$/.test(entry.name)) continue;
    try {
      const point = await readOnlineCheckpointDirectory(root, import_node_path2.default.join(root, entry.name));
      const metadata = point.metadata;
      inventory.push({
        ...metadata,
        remotePath: point.directory,
        archivePath: point.directory,
        metadataPath: point.metadataPath,
        onlineDirectoryEvidence: point.evidence
      });
      metadataSnapshots.set(point.metadataPath, await import_node_fs2.default.promises.readFile(point.metadataPath, "utf8"));
    } catch {
    }
  }
  if (new Set(inventory.map((artifact) => artifact.id)).size !== inventory.length) {
    throw new Error("DEPLOYMENT_RETENTION_DUPLICATE_ID");
  }
  const plan = planRemoteCheckpointRetention(inventory.map((artifact) => ({
    id: artifact.id,
    releaseId: artifact.releaseId,
    createdAt: new Date(artifact.createdAt),
    size: artifact.size,
    remoteVerified: artifact.remoteVerified,
    restoreVerified: artifact.restoreVerified === true,
    checksum: artifact.checksum,
    sourceMachineUuidSha256: artifact.sourceMachineUuidSha256,
    sourceKernelBootIdSha256: artifact.sourceKernelBootIdSha256,
    lastDrill: artifact.lastDrill,
    onlineDirectoryEvidence: artifact.onlineDirectoryEvidence,
    active: artifact.id === activeDeploymentId || artifact.active === true,
    incidentOpen: artifact.incidentOpen === true || localHolds.has(artifact.id)
  })));
  const audit = [];
  const resolvedRoot = import_node_path2.default.resolve(root);
  const realRoot = await import_node_fs2.default.promises.realpath(root);
  const verifyContainedFile = async (file) => {
    const resolved = await import_node_fs2.default.promises.realpath(file);
    const stat = await import_node_fs2.default.promises.lstat(file);
    if (!resolved.startsWith(`${realRoot}${import_node_path2.default.sep}`) || !stat.isFile() || stat.isSymbolicLink()) {
      throw Object.assign(new Error("Checkpoint retention path is unsafe."), { code: "DEPLOYMENT_REMOTE_RETENTION_PATH_UNSAFE" });
    }
    return stat;
  };
  const replacements = inventory.filter((artifact) => plan.keepIds.includes(artifact.id) && hasHealthyRemoteRecoveryPoint({ ...artifact, createdAt: new Date(artifact.createdAt), active: !!artifact.active, incidentOpen: !!artifact.incidentOpen }) && artifact.remoteVerified).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 2);
  const fingerprints = /* @__PURE__ */ new Map();
  if (plan.deleteIds.length) {
    if (replacements.length !== 2 || new Set(replacements.map((point) => point.id)).size !== 2) throw new Error("DEPLOYMENT_RETENTION_REPLACEMENTS_MISSING");
    for (const artifact of replacements) {
      if (artifact.onlineDirectoryEvidence) {
        await assertOnlineCheckpointDirectoryUnchanged(artifact.onlineDirectoryEvidence);
        continue;
      }
      const stat = await verifyContainedFile(artifact.remotePath);
      await verifyContainedFile(artifact.metadataPath);
      if (stat.size !== artifact.size || await remoteCheckpointChecksum(artifact.remotePath) !== artifact.checksum) {
        throw Object.assign(new Error("A retained checkpoint failed verification."), { code: "DEPLOYMENT_RETENTION_REPLACEMENT_INVALID" });
      }
      fingerprints.set(artifact.id, { size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  for (const id of options.mode === "inspect" ? [] : plan.deleteIds) {
    if (localRoot) {
      const currentFiles = await findMetadataFiles(localRoot);
      if (currentFiles.length !== localEvidence.size) throw new Error("DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_CHANGED");
      for (const file of currentFiles) {
        if (await import_node_fs2.default.promises.readFile(file, "utf8") !== localEvidence.get(file)) {
          throw new Error("DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_CHANGED");
        }
      }
    }
    const artifact = inventory.find((candidate) => candidate.id === id);
    if (!artifact) continue;
    const archivePresent = artifact.onlineDirectoryEvidence ? true : await checkpointArchivePresent(realRoot, artifact.archivePath, artifact);
    for (const candidate of [artifact.metadataPath]) {
      if (!import_node_path2.default.resolve(candidate).startsWith(`${resolvedRoot}${import_node_path2.default.sep}`)) {
        throw Object.assign(new Error("Remote retention candidate escaped its configured root."), { code: "DEPLOYMENT_REMOTE_RETENTION_PATH_UNSAFE" });
      }
      await verifyContainedFile(candidate);
    }
    const current = JSON.parse(await import_node_fs2.default.promises.readFile(artifact.metadataPath, "utf8"));
    if (current.active || current.incidentOpen || current.id !== artifact.id || current.checksum !== artifact.checksum) {
      throw new Error("DEPLOYMENT_RETENTION_EVIDENCE_CHANGED");
    }
    for (const replacement of replacements) {
      if (await import_node_fs2.default.promises.readFile(replacement.metadataPath, "utf8") !== metadataSnapshots.get(replacement.metadataPath)) {
        throw new Error("DEPLOYMENT_RETENTION_REPLACEMENT_EVIDENCE_CHANGED");
      }
      if (replacement.onlineDirectoryEvidence) await assertOnlineCheckpointDirectoryUnchanged(replacement.onlineDirectoryEvidence);
      else await assertRemoteCheckpointFingerprint(replacement.remotePath, fingerprints.get(replacement.id));
    }
    await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: "RETENTION_INTENT" });
    if (artifact.onlineDirectoryEvidence) {
      await removeVerifiedOnlineCheckpointDirectory(artifact.onlineDirectoryEvidence);
      await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: "RETENTION_ARCHIVE_REMOVED" });
      await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: "RETENTION_COMPLETED" });
      audit.push({
        id,
        releaseId: artifact.releaseId,
        checksum: artifact.checksum,
        size: artifact.size,
        reason: "TWO_VERIFIED_COMPLETE_RECOVERY_POINTS",
        result: "DELETED"
      });
      continue;
    }
    if (archivePresent) await import_node_fs2.default.promises.unlink(artifact.archivePath);
    await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: "RETENTION_ARCHIVE_REMOVED" });
    await import_node_fs2.default.promises.unlink(artifact.metadataPath);
    await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: "RETENTION_COMPLETED" });
    audit.push({ id, releaseId: artifact.releaseId, checksum: artifact.checksum, size: artifact.size, reason: "TWO_VERIFIED_COMPLETE_RECOVERY_POINTS", result: "DELETED" });
  }
  const retainedPoints = replacements.map((artifact) => ({
    id: artifact.id,
    checksum: artifact.checksum,
    size: artifact.size,
    createdAt: artifact.createdAt,
    remotePath: artifact.remotePath,
    fingerprint: fingerprints.get(artifact.id),
    metadataPath: artifact.metadataPath,
    metadataSha256: (0, import_node_crypto2.createHash)("sha256").update(metadataSnapshots.get(artifact.metadataPath)).digest("hex"),
    onlineDirectoryEvidence: artifact.onlineDirectoryEvidence
  }));
  return {
    plan,
    audit,
    retainedPoints,
    protectionEvidence: inventory.map((artifact) => ({
      id: artifact.id,
      metadataPath: artifact.metadataPath
    }))
  };
};

// backend/src/services/deploymentBackupRetention.ts
var import_strict = __toESM(require("node:assert/strict"));
var import_node_fs3 = __toESM(require("node:fs"));
var import_node_crypto3 = require("node:crypto");
var BACKUP_CHECKPOINT_ROOT = "/srv/sabalanerp-recovery/checkpoints";
var BACKUP_STORAGE_LOCK = "/run/lock/sabalan-backup-storage.lock";
var canonicalRetentionBytes = (value) => Buffer.from(JSON.stringify(canonical2(value)));
var canonical2 = (value) => Array.isArray(value) ? value.map(canonical2) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical2(value[key])])) : value;
var retentionSha256 = (raw) => (0, import_node_crypto3.createHash)("sha256").update(raw).digest("hex");
function parseBackupRetentionRequest(raw) {
  import_strict.default.ok(raw.length > 0 && raw.length <= 1024 * 1024);
  const value = JSON.parse(raw.toString());
  import_strict.default.deepEqual(Object.keys(value).sort(), ["format", "deploymentId", "requestId", "protectedCheckpointIds"].sort());
  import_strict.default.equal(value.format, "sabalan-restricted-backup-retention-request/v1");
  import_strict.default.match(value.deploymentId, /^[a-zA-Z0-9_-]{8,160}$/);
  import_strict.default.match(value.requestId, /^[a-f0-9]{64}$/);
  import_strict.default.ok(Array.isArray(value.protectedCheckpointIds) && value.protectedCheckpointIds.length <= 4096);
  import_strict.default.ok(value.protectedCheckpointIds.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(id)));
  import_strict.default.equal(new Set(value.protectedCheckpointIds).size, value.protectedCheckpointIds.length);
  return value;
}
function assertBackupStorageLockFileIdentity(named, owned) {
  for (const value of [named, owned]) import_strict.default.ok(value.isFile() && value.uid === 0n && value.nlink === 1n && (value.mode & 0o022n) === 0n, "BACKUP_STORAGE_LOCK_CUSTODY");
  for (const key of ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) import_strict.default.equal(named[key], owned[key], "BACKUP_STORAGE_LOCK_IDENTITY_CHANGED");
}
function assertOriginalBackupStorageLock() {
  import_strict.default.equal(process.platform, "linux");
  import_strict.default.equal(process.getuid?.(), 0);
  import_strict.default.equal(import_node_fs3.default.realpathSync(BACKUP_STORAGE_LOCK), BACKUP_STORAGE_LOCK);
  const named = import_node_fs3.default.lstatSync(BACKUP_STORAGE_LOCK, { bigint: true }), owned = import_node_fs3.default.fstatSync(9, { bigint: true });
  assertBackupStorageLockFileIdentity(named, owned);
  const locks = [...import_node_fs3.default.readFileSync("/proc/self/fdinfo/9", "utf8").matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)];
  import_strict.default.ok(locks.some((row) => row[1] === String(owned.ino)));
  import_strict.default.equal(import_node_fs3.default.realpathSync(BACKUP_STORAGE_LOCK), BACKUP_STORAGE_LOCK);
  assertBackupStorageLockFileIdentity(named, import_node_fs3.default.lstatSync(BACKUP_STORAGE_LOCK, { bigint: true }));
  assertBackupStorageLockFileIdentity(owned, import_node_fs3.default.fstatSync(9, { bigint: true }));
  return { device: String(owned.dev), inode: String(owned.ino), ownerUid: 0, descriptor: 9 };
}

// backend/src/scripts/backup-checkpoint-retention.ts
async function main() {
  import_strict2.default.equal(process.argv.length, 2);
  const lock = assertOriginalBackupStorageLock();
  let total = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    total += chunk.length;
    import_strict2.default.ok(total <= 1024 * 1024);
    chunks.push(Buffer.from(chunk));
  }
  const request = parseBackupRetentionRequest(Buffer.concat(chunks));
  import_strict2.default.equal(await import_node_fs4.default.promises.realpath(BACKUP_CHECKPOINT_ROOT), BACKUP_CHECKPOINT_ROOT);
  assertOriginalBackupStorageLock();
  const result = await enforceFilesystemRemoteRetention(BACKUP_CHECKPOINT_ROOT, request.deploymentId, void 0, { protectedCheckpointIds: request.protectedCheckpointIds });
  assertOriginalBackupStorageLock();
  const response = {
    format: "sabalan-original-backup-retention-result/v1",
    requestSha256: retentionSha256(canonicalRetentionBytes(request)),
    requestId: request.requestId,
    deploymentId: request.deploymentId,
    storageRoot: BACKUP_CHECKPOINT_ROOT,
    originalPid: process.pid,
    originalStorageLock: lock,
    plan: result.plan,
    audit: result.audit,
    retainedPoints: result.retainedPoints.map((row) => ({ id: row.id, checksum: row.checksum, size: row.size, metadataSha256: row.metadataSha256 }))
  };
  const raw = canonicalRetentionBytes(response);
  import_strict2.default.ok(raw.length <= 4 * 1024 * 1024);
  process.stdout.write(Buffer.concat([raw, Buffer.from("\n")]));
}
main().catch(() => {
  process.stderr.write("ORIGINAL_BACKUP_RETENTION_FAILED\n");
  process.exitCode = 1;
});

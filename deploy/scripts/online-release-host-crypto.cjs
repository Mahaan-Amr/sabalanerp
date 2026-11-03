"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/src/services/recoveryCrypto.ts
var recoveryCrypto_exports = {};
__export(recoveryCrypto_exports, {
  decryptRecoveryArchive: () => decryptRecoveryArchive,
  encryptRecoveryArchive: () => encryptRecoveryArchive,
  encryptRecoveryArchiveForRecipients: () => encryptRecoveryArchiveForRecipients,
  sha256File: () => sha256File
});
module.exports = __toCommonJS(recoveryCrypto_exports);
var import_crypto = __toESM(require("crypto"));
var import_fs = __toESM(require("fs"));
var import_stream = require("stream");
var MAGIC = Buffer.from("SABREC01");
var TAG_BYTES = 16;
var deriveKey = (passphrase, salt) => new Promise((resolve, reject) => {
  import_crypto.default.scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error);
    else resolve(key);
  });
});
var sha256File = (filePath) => new Promise((resolve, reject) => {
  const hash = import_crypto.default.createHash("sha256");
  const stream = import_fs.default.createReadStream(filePath);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});
var pipeline = async (...streams) => {
  const { pipeline: run } = await import("stream/promises");
  await run(streams);
};
var encryptRecoveryArchive = async (sourcePath, destinationPath, passphrase) => {
  const salt = import_crypto.default.randomBytes(16);
  const iv = import_crypto.default.randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const header = {
    format: "sabalan-recovery",
    version: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64")
  };
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8");
  const prefix = Buffer.alloc(MAGIC.length + 4 + encodedHeader.length);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(encodedHeader.length, MAGIC.length);
  encodedHeader.copy(prefix, MAGIC.length + 4);
  const output = import_fs.default.createWriteStream(destinationPath, { flags: "wx" });
  output.write(prefix);
  const cipher = import_crypto.default.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(encodedHeader);
  await pipeline(import_fs.default.createReadStream(sourcePath), cipher, output);
  await import_fs.default.promises.appendFile(destinationPath, cipher.getAuthTag());
};
var encryptRecoveryArchiveForRecipients = async (sourcePath, destinationPath, recipients) => {
  if (recipients.length < 2 || new Set(recipients.map((recipient) => recipient.keyId)).size !== recipients.length) {
    throw Object.assign(new Error("At least two uniquely identified recovery recipients are required."), { code: "RECOVERY_RECIPIENTS_INVALID" });
  }
  const dataKey = import_crypto.default.randomBytes(32);
  const iv = import_crypto.default.randomBytes(12);
  const wrappedRecipients = [];
  for (const recipient of recipients) {
    if ("publicKeyPem" in recipient) {
      const wrappedKey2 = import_crypto.default.publicEncrypt({
        key: recipient.publicKeyPem,
        padding: import_crypto.default.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
      }, dataKey);
      wrappedRecipients.push({
        keyId: recipient.keyId,
        algorithm: "rsa-oaep-sha256",
        wrappedKey: wrappedKey2.toString("base64")
      });
      continue;
    }
    const salt = import_crypto.default.randomBytes(16);
    const wrappingIv = import_crypto.default.randomBytes(12);
    const wrappingKey = await deriveKey(recipient.passphrase, salt);
    const wrapper = import_crypto.default.createCipheriv("aes-256-gcm", wrappingKey, wrappingIv);
    wrapper.setAAD(Buffer.from(`sabalan-recovery-key:${recipient.keyId}`, "utf8"));
    const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);
    wrappedRecipients.push({
      keyId: recipient.keyId,
      algorithm: "scrypt-aes-256-gcm",
      salt: salt.toString("base64"),
      iv: wrappingIv.toString("base64"),
      wrappedKey: wrappedKey.toString("base64"),
      tag: wrapper.getAuthTag().toString("base64")
    });
  }
  const header = {
    format: "sabalan-recovery",
    version: 2,
    cipher: "aes-256-gcm",
    keyWrapping: "multi-recipient-v1",
    iv: iv.toString("base64"),
    recipients: wrappedRecipients
  };
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8");
  const prefix = Buffer.alloc(MAGIC.length + 4 + encodedHeader.length);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(encodedHeader.length, MAGIC.length);
  encodedHeader.copy(prefix, MAGIC.length + 4);
  const output = import_fs.default.createWriteStream(destinationPath, { flags: "wx" });
  output.write(prefix);
  const cipher = import_crypto.default.createCipheriv("aes-256-gcm", dataKey, iv);
  cipher.setAAD(encodedHeader);
  await pipeline(import_fs.default.createReadStream(sourcePath), cipher, output);
  await import_fs.default.promises.appendFile(destinationPath, cipher.getAuthTag());
};
var decryptRecoveryArchive = async (sourcePath, destinationPath, passphrase) => {
  const descriptor = await import_fs.default.promises.open(sourcePath, "r");
  try {
    const stat = await descriptor.stat();
    const prefix = Buffer.alloc(MAGIC.length + 4);
    await descriptor.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw Object.assign(new Error("Invalid recovery package."), { code: "INVALID_RECOVERY_PACKAGE" });
    const headerLength = prefix.readUInt32BE(MAGIC.length);
    if (headerLength <= 0 || headerLength > 16384) throw Object.assign(new Error("Invalid recovery header."), { code: "INVALID_RECOVERY_PACKAGE" });
    const encodedHeader = Buffer.alloc(headerLength);
    await descriptor.read(encodedHeader, 0, headerLength, prefix.length);
    const header = JSON.parse(encodedHeader.toString("utf8"));
    if (header.format !== "sabalan-recovery" || ![1, 2].includes(header.version)) throw Object.assign(new Error("Unsupported recovery package format."), { code: "UNSUPPORTED_RECOVERY_FORMAT" });
    const tag = Buffer.alloc(TAG_BYTES);
    await descriptor.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    const ciphertextStart = prefix.length + headerLength;
    const ciphertextEnd = stat.size - TAG_BYTES - 1;
    if (ciphertextEnd < ciphertextStart - 1) throw Object.assign(new Error("Recovery package is truncated."), { code: "INVALID_RECOVERY_PACKAGE" });
    let key;
    if (header.version === 1) {
      key = await deriveKey(passphrase, Buffer.from(header.salt, "base64"));
    } else {
      let unwrapped = null;
      for (const recipient of header.recipients) {
        try {
          if (recipient.algorithm === "rsa-oaep-sha256") {
            unwrapped = import_crypto.default.privateDecrypt({
              key: passphrase,
              padding: import_crypto.default.constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: "sha256"
            }, Buffer.from(recipient.wrappedKey, "base64"));
          } else {
            const wrappingKey = await deriveKey(passphrase, Buffer.from(recipient.salt || "", "base64"));
            const unwrapper = import_crypto.default.createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(recipient.iv || "", "base64"));
            unwrapper.setAAD(Buffer.from(`sabalan-recovery-key:${recipient.keyId}`, "utf8"));
            unwrapper.setAuthTag(Buffer.from(recipient.tag || "", "base64"));
            unwrapped = Buffer.concat([unwrapper.update(Buffer.from(recipient.wrappedKey, "base64")), unwrapper.final()]);
          }
          break;
        } catch {
        }
      }
      if (!unwrapped) throw Object.assign(new Error("Backup key is incorrect or no recipient can unwrap the package."), { code: "RECOVERY_DECRYPTION_FAILED" });
      key = unwrapped;
    }
    const decipher = import_crypto.default.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
    decipher.setAAD(encodedHeader);
    decipher.setAuthTag(tag);
    try {
      const ciphertext = ciphertextEnd === ciphertextStart - 1 ? import_stream.Readable.from([]) : import_fs.default.createReadStream(sourcePath, { start: ciphertextStart, end: ciphertextEnd });
      await pipeline(ciphertext, decipher, import_fs.default.createWriteStream(destinationPath, { flags: "wx" }));
    } catch {
      await import_fs.default.promises.rm(destinationPath, { force: true });
      throw Object.assign(new Error("Backup passphrase is incorrect or the package was modified."), { code: "RECOVERY_DECRYPTION_FAILED" });
    }
  } finally {
    await descriptor.close();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  decryptRecoveryArchive,
  encryptRecoveryArchive,
  encryptRecoveryArchiveForRecipients,
  sha256File
});

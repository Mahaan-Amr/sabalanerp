/** Diagnostic HTTP-only child, captured as literal source in the main bundle.
 * Private session enters only through anonymous stdin. No Prisma, runtime,
 * publication, filesystem writer, or native authority imports. */
export const SUPPORT_STAGED_HTTP_TARGET_SOURCE = String.raw`function validateSupportHttpTarget(baseUrl, expectedHost) {
  const assert = require("node:assert/strict");
  const { isIP } = require("node:net");
  assert.equal(typeof expectedHost, "string");
  assert.equal(isIP(expectedHost), 4, "SUPPORT_HTTP_PRIVATE_IPV4_REQUIRED");
  const octets = expectedHost.split(".").map(Number);
  assert.ok(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168), "SUPPORT_HTTP_PRIVATE_HOST_REQUIRED");
  assert.ok(Object.values(require("node:os").networkInterfaces()).flat().some(value => value && !value.internal
    && value.family === "IPv4" && value.address === expectedHost), "SUPPORT_HTTP_ASSIGNED_INTERFACE_REQUIRED");
  const target = new URL(baseUrl);
  assert.equal(target.protocol, "http:");
  assert.equal(target.hostname, expectedHost, "SUPPORT_HTTP_ENROLLED_HOST_CHANGED");
  assert.equal(target.username + target.password + target.search + target.hash, "");
  assert.equal(target.pathname, "/");
  assert.ok(target.port && Number(target.port) >= 1024 && Number(target.port) <= 65535);
  return target;
}`;

export const SUPPORT_STAGED_HTTP_CLIENT_SOURCE = SUPPORT_STAGED_HTTP_TARGET_SOURCE + String.raw`
async function runSupportStagedHttpClient() {
  const assert = require("node:assert/strict");
  const { createHash, randomUUID } = require("node:crypto");
  const sha = (bytes2) => createHash("sha256").update(bytes2).digest("hex");
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
    assert.ok(Buffer.byteLength(raw) <= 16384);
  }
  const input = JSON.parse(raw);
  raw = "";
  assert.equal(input.format, "sabalan-support-staged-http-client-input/v2");
  const target = validateSupportHttpTarget(input.baseUrl, input.expectedHost);
  assert.equal(typeof input.sessionToken, "string");
  assert.ok(input.sessionToken.length >= 20 && input.sessionToken.length <= 512);
  const baseUrl = target.origin, cookie = "sabalan_session=" + input.sessionToken, run = randomUUID();
  function buildLargeSupportPdf() {
    const content = Buffer.from("q\n" + ("%" + "A".repeat(126) + "\n").repeat(17 * 1024 * 1024 / 128) + "Q\n", "ascii");
    const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")], offsets = [];
    let length = chunks[0].length;
    const object = (id, bytes3) => {
      offsets.push(length);
      const chunk = Buffer.concat([Buffer.from("".concat(id, " 0 obj\n")), bytes3, Buffer.from("\nendobj\n")]);
      chunks.push(chunk);
      length += chunk.length;
    };
    object(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
    object(2, Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
    object(3, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>"));
    object(4, Buffer.concat([Buffer.from("<< /Length ".concat(content.length, " >>\nstream\n")), content, Buffer.from("endstream")]));
    const xref = length;
    chunks.push(Buffer.from("xref\n0 5\n0000000000 65535 f \n" + offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n".concat(xref, "\n%%EOF\n")));
    const bytes2 = Buffer.concat(chunks);
    assert.ok(bytes2.length > 17 * 1024 * 1024 && bytes2.length < 25 * 1024 * 1024);
    assert.equal(bytes2.subarray(xref, xref + 4).toString(), "xref");
    offsets.forEach((offset, i) => assert.equal(bytes2.subarray(offset, offset + 7).toString(), "".concat(i + 1, " 0 obj")));
    return bytes2;
  }
  const bytes = buildLargeSupportPdf(), digest = sha(bytes), originalName = "native-large-valid.pdf";
  assert.equal(bytes.length, 17826244);
  assert.equal(digest, "a0d7162c0efb828b1df63eeec4f32efba8f857e72b0daa393e890ccca86b3e33");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), originalName);
  const staged = await fetch(baseUrl + "/api/support-tickets/attachments/stage", {
    method: "POST",
    headers: { Cookie: cookie, "x-idempotency-key": "native-support-stage-" + run },
    body: form
  });
  const stagedBody = await staged.json();
  assert.equal(staged.status, 201, "Canonical staging failed");
  assert.equal(typeof stagedBody.data.token, "string");
  const descriptor = JSON.parse(Buffer.from(stagedBody.data.token.split(".")[0], "base64url").toString());
  assert.equal(descriptor.sha256, digest);
  assert.equal(descriptor.size, bytes.length);
  assert.equal(descriptor.mimeType, "application/pdf");
  const title = "Private native large staged document " + run;
  const description = "Actual canonical stage and JSON promotion of a valid document above sixteen MiB.";
  const created = await fetch(baseUrl + "/api/support-tickets", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-idempotency-key": "native-support-create-" + run
    },
    body: JSON.stringify({
      title,
      description,
      type: "TECHNICAL_ERROR",
      impact: "SINGLE_TASK",
      workaroundExists: false,
      originRoute: "/dashboard/support/tickets",
      stagedAttachmentTokens: [stagedBody.data.token]
    })
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201, "Canonical token promotion failed");
  const detail = await fetch(baseUrl + "/api/support-tickets/" + encodeURIComponent(createdBody.data.id), { headers: { Cookie: cookie } });
  const detailBody = await detail.json();
  assert.equal(detail.status, 200);
  assert.equal(detailBody.data.attachments.length, 1);
  const attachment = detailBody.data.attachments[0];
  assert.equal(attachment.sha256, digest);
  assert.equal(attachment.size, bytes.length);
  const resource = baseUrl + "/api/support-tickets/attachments/" + encodeURIComponent(attachment.id) + "/download";
  const downloaded = await fetch(resource, { headers: { Cookie: cookie } });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type")?.split(";")[0], "application/pdf");
  assert.equal(Number(downloaded.headers.get("content-length")), bytes.length);
  assert.ok(downloaded.body);
  let size = 0;
  const hash = createHash("sha256");
  for await (const chunk of downloaded.body) {
    size += chunk.length;
    hash.update(chunk);
  }
  assert.equal(size, bytes.length);
  assert.equal(hash.digest("hex"), digest);
  const denied = await fetch(resource);
  assert.equal(denied.status, 401);
  await denied.arrayBuffer();
  const result = {
    format: "sabalan-support-staged-http-client-result/v1",
    ticketId: createdBody.data.id,
    attachmentId: attachment.id,
    storageName: descriptor.storageName,
    sha256: digest,
    bytes: bytes.length,
    title,
    description,
    originalName,
    actualPdfXrefQualified: true
  };
  await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(result) + "\n", (error) => error ? reject(error) : resolve()));
}

void runSupportStagedHttpClient().catch(error => { console.error(error?.stack || "SUPPORT_HTTP_CLIENT_FAILED"); process.exitCode = 1; });
`;

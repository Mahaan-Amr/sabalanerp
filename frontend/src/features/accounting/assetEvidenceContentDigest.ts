/** The digest is used only to distinguish retry keys; the server verifies uploaded bytes independently. */
export async function assetEvidenceContentDigest(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('امکان بررسی فایل در این مرورگر وجود ندارد.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export async function buildAssetEvidenceForm(bookId: string, purpose: 'COST' | 'READY', file: File): Promise<FormData> {
  const data = new FormData();
  data.append('bookId', bookId);
  data.append('purpose', purpose);
  data.append('contentDigest', await assetEvidenceContentDigest(file));
  data.append('file', file);
  return data;
}

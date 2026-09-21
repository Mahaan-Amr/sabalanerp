const magic = Buffer.from('SBIOIMG1');
const headerLength = magic.length + 8;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const maximumCaptureImageBytes = 1_048_576;
export const maximumEnrollmentCaptureBytes = headerLength + 4_096 + maximumCaptureImageBytes;

export const decodeEnrollmentCaptureMaterial = (material: Buffer) => {
  if (!Buffer.isBuffer(material) || material.length < headerLength || !material.subarray(0, magic.length).equals(magic)) throw new Error('Enrollment capture material is invalid');
  const templateLength = material.readUInt32BE(magic.length);
  const imageLength = material.readUInt32BE(magic.length + 4);
  if (templateLength === 0 || templateLength > 4_096 || imageLength === 0 || imageLength > maximumCaptureImageBytes || material.length !== headerLength + templateLength + imageLength) throw new Error('Enrollment capture material is invalid');
  const templateMaterial = Buffer.from(material.subarray(headerLength, headerLength + templateLength));
  const imageMaterial = Buffer.from(material.subarray(headerLength + templateLength));
  if (!imageMaterial.subarray(0, pngSignature.length).equals(pngSignature)) {
    templateMaterial.fill(0);
    imageMaterial.fill(0);
    throw new Error('Enrollment capture image is not PNG');
  }
  return { templateMaterial, imageMaterial };
};

const magic = Buffer.from('SBIOIMG1');
const headerLength = magic.length + 8;
export const maximumCaptureImageBytes = 1_048_576;
export const maximumEnrollmentCaptureBytes = headerLength + 4_096 + maximumCaptureImageBytes;

export const encodeEnrollmentCaptureMaterial = (template: Buffer, imagePng: Buffer) => {
  if (!Buffer.isBuffer(template) || template.length === 0 || template.length > 4_096) throw new Error('Enrollment template is invalid');
  if (!Buffer.isBuffer(imagePng) || imagePng.length === 0 || imagePng.length > maximumCaptureImageBytes) throw new Error('Enrollment capture image is invalid');
  const header = Buffer.alloc(headerLength);
  magic.copy(header);
  header.writeUInt32BE(template.length, magic.length);
  header.writeUInt32BE(imagePng.length, magic.length + 4);
  return Buffer.concat([header, template, imagePng]);
};

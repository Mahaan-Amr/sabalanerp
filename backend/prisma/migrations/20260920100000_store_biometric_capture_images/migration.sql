ALTER TABLE "driver_biometric_templates"
  ADD COLUMN "protectedImageEnvelope" JSONB,
  ADD COLUMN "imageMimeType" TEXT,
  ADD COLUMN "imageWidth" INTEGER,
  ADD COLUMN "imageHeight" INTEGER,
  ADD COLUMN "imageByteLength" INTEGER;

ALTER TABLE "driver_biometric_templates"
  ADD CONSTRAINT "driver_biometric_templates_image_metadata_check"
  CHECK (
    ("protectedImageEnvelope" IS NULL AND "imageMimeType" IS NULL AND "imageWidth" IS NULL AND "imageHeight" IS NULL AND "imageByteLength" IS NULL)
    OR
    ("protectedImageEnvelope" IS NOT NULL AND "imageMimeType" = 'image/png' AND "imageWidth" > 0 AND "imageHeight" > 0 AND "imageByteLength" > 0)
  );

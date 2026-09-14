ALTER TABLE "partner_release_readiness_publications"
  ADD COLUMN "packageBytesBase64" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "trustEnvelopeBytesBase64" TEXT NOT NULL DEFAULT '';

ALTER TABLE "partner_release_readiness_publications"
  ALTER COLUMN "packageBytesBase64" DROP DEFAULT,
  ALTER COLUMN "trustEnvelopeBytesBase64" DROP DEFAULT;

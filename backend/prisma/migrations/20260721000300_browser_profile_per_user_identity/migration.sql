DROP INDEX IF EXISTS "recognized_browser_profiles_publicId_key";
CREATE UNIQUE INDEX "recognized_browser_profiles_userId_publicId_key" ON "recognized_browser_profiles"("userId", "publicId");
UPDATE "users" SET "erasedUsernameSnapshot" = NULL WHERE "erasedAt" IS NOT NULL;

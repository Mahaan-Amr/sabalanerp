ALTER TABLE "external_driver_personnel_continuity_links"
  ADD CONSTRAINT "external_driver_personnel_continuity_links_personnelId_fkey"
  FOREIGN KEY ("personnelId") REFERENCES "personnel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

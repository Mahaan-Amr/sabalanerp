ALTER TABLE "sub_services" ADD COLUMN "minimumQuantity" DECIMAL(18,3);
ALTER TABLE "stone_finishings" ADD COLUMN "minimumQuantity" DECIMAL(18,3);
ALTER TABLE "sub_services" ADD CONSTRAINT "sub_services_minimum_quantity_nonnegative" CHECK ("minimumQuantity" IS NULL OR "minimumQuantity" >= 0);
ALTER TABLE "stone_finishings" ADD CONSTRAINT "stone_finishings_minimum_quantity_nonnegative" CHECK ("minimumQuantity" IS NULL OR "minimumQuantity" >= 0);
INSERT INTO "role_feature_permissions" ("id", "role", "workspace", "feature", "permissionLevel", "isActive", "createdAt", "updatedAt")
VALUES ('operation-minimum-admin-default', 'ADMIN', 'inventory', 'inventory_operation_minimum_edit', 'admin', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('operation-minimum-manager-default', 'MANAGER', 'inventory', 'inventory_operation_minimum_edit', 'edit', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "workspace", "feature") DO NOTHING;

ALTER TABLE "layer_types" ADD COLUMN "code" TEXT;
ALTER TABLE "stone_finishings" ADD COLUMN "code" TEXT;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn
  FROM "layer_types"
)
UPDATE "layer_types"
SET "code" = 'LT-' || LPAD(numbered.rn::TEXT, 3, '0')
FROM numbered
WHERE "layer_types".id = numbered.id;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn
  FROM "stone_finishings"
)
UPDATE "stone_finishings"
SET "code" = 'SF-' || LPAD(numbered.rn::TEXT, 3, '0')
FROM numbered
WHERE "stone_finishings".id = numbered.id;

ALTER TABLE "layer_types" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "stone_finishings" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "layer_types_code_key" ON "layer_types"("code");
CREATE UNIQUE INDEX "stone_finishings_code_key" ON "stone_finishings"("code");

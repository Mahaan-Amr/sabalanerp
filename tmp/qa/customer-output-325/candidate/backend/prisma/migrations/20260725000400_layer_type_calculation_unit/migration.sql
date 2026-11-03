ALTER TABLE "layer_types"
ADD COLUMN "calculationUnit" TEXT NOT NULL DEFAULT 'set';

ALTER TABLE "layer_types"
ADD CONSTRAINT "layer_types_calculationUnit_check"
CHECK ("calculationUnit" IN ('set', 'physicalPiece', 'meter', 'squareMeter'));

UPDATE "departments"
SET "namePersian" = REPLACE("namePersian", 'حراست', 'گارد')
WHERE "namePersian" LIKE '%حراست%';

UPDATE "security_personnel"
SET "position" = REPLACE("position", 'حراست', 'گارد')
WHERE "position" LIKE '%حراست%';

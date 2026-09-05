DROP TRIGGER performance_user_disclosure_revision ON users;
CREATE TRIGGER performance_user_disclosure_revision BEFORE UPDATE OF "isActive", "personnelId" ON users
FOR EACH STATEMENT EXECUTE FUNCTION performance_bump_disclosure_revision();

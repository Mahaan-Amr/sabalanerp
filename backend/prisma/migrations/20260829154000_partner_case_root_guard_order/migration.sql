-- PostgreSQL fires same-timing triggers alphabetically. Run the immutable root
-- guard before the Case CAS guard so a re-parent attempt receives the precise
-- invariant failure and never depends on callers also advancing revisions.
DROP TRIGGER IF EXISTS partner_case_first_evidence_guard ON partner_sale_cases;
CREATE TRIGGER partner_case_00_profile_root_guard
  BEFORE INSERT OR UPDATE OF "profileId" ON partner_sale_cases
  FOR EACH ROW EXECUTE FUNCTION partner_mark_first_owned_evidence_irreversible();

-- Close writers that could otherwise wait across Partner conversion and commit
-- incompatible work after the activation gate was evaluated.
CREATE OR REPLACE FUNCTION partner_reject_incompatible_persona() RETURNS trigger AS $$
DECLARE
  subject_id text;
  irreversible_at timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'workspace_permissions' OR TG_TABLE_NAME = 'feature_permissions' THEN
    IF NOT NEW."isActive" OR (NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= clock_timestamp()) THEN RETURN NEW; END IF;
    subject_id := NEW."userId";
  ELSIF TG_TABLE_NAME = 'effective_action_grants' THEN
    -- Future grants are incompatible too: they must not silently wake up after
    -- the persona has become irreversible.
    IF NEW."subjectUserId" IS NULL OR NEW.domain = 'PARTNER' OR NEW.effect <> 'ALLOW' OR NEW."revokedAt" IS NOT NULL
       OR (NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= clock_timestamp()) THEN RETURN NEW; END IF;
    subject_id := NEW."subjectUserId";
  ELSIF TG_TABLE_NAME = 'sales_contracts' THEN
    IF NEW."partnerKind" = 'PARTNER_CUSTOMER' OR NEW."isInactive"
       OR NEW.status::text NOT IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED') THEN RETURN NEW; END IF;
    subject_id := NEW."responsibleSellerId";
  ELSIF TG_TABLE_NAME = 'sales_contract_edit_sessions' THEN
    subject_id := NEW."ownerUserId";
  ELSIF TG_TABLE_NAME = 'hr_duties' THEN
    IF NEW.status <> 'OPEN' OR NEW."currentAssigneeUserId" IS NULL THEN RETURN NEW; END IF;
    subject_id := NEW."currentAssigneeUserId";
  ELSIF TG_TABLE_NAME IN ('partner_profile_responder_assignments', 'partner_inquiry_assignments') THEN
    subject_id := NEW."responderId";
  ELSIF TG_TABLE_NAME = 'users' THEN
    IF NEW.role::text = 'USER' THEN RETURN NEW; END IF;
    subject_id := NEW.id;
  ELSE
    RAISE EXCEPTION 'unsupported Partner persona guard table';
  END IF;

  SELECT "irreversibleAt" INTO irreversible_at FROM partner_profiles
    WHERE "userId" = subject_id FOR UPDATE;
  IF irreversible_at IS NOT NULL THEN
    RAISE EXCEPTION 'incompatible authority or responsibility for irreversible Partner persona'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER partner_persona_contract_guard ON sales_contracts;
CREATE TRIGGER partner_persona_contract_guard
  BEFORE INSERT OR UPDATE OF "responsibleSellerId", "partnerKind", status, "isInactive" ON sales_contracts
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();

CREATE TRIGGER partner_persona_edit_session_guard
  BEFORE INSERT OR UPDATE OF "ownerUserId" ON sales_contract_edit_sessions
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();

-- Re-read lifecycle after waiting for the Profile lock. A request authorized
-- before suspension/termination cannot commit once that transition wins.
CREATE OR REPLACE FUNCTION partner_lock_inquiry_profile() RETURNS trigger AS $$
DECLARE
  inquiry_id text;
  profile_id text;
  profile_state text;
BEGIN
  inquiry_id := CASE WHEN TG_TABLE_NAME = 'partner_inquiries' THEN NEW.id ELSE NEW."inquiryId" END;
  SELECT "profileId" INTO profile_id FROM partner_inquiries WHERE id = inquiry_id;
  IF profile_id IS NULL AND TG_TABLE_NAME = 'partner_inquiries' THEN profile_id := NEW."profileId"; END IF;
  IF profile_id IS NOT NULL THEN
    SELECT state::text INTO profile_state FROM partner_profiles WHERE id = profile_id FOR UPDATE;
    IF profile_state IN ('SUSPENDED', 'TERMINATED') THEN
      RAISE EXCEPTION 'Partner profile lifecycle blocks inquiry mutation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

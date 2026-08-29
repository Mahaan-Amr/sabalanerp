-- An open Accounting correction is internal work. Serialize its assignment
-- with Profile activation through the same Profile row lock as every other
-- incompatible authority/responsibility source.
CREATE OR REPLACE FUNCTION partner_reject_incompatible_persona() RETURNS trigger AS $$
DECLARE
  subject_id text;
  irreversible_at timestamptz;
  profile_state text;
  partner_technical_session boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'workspace_permissions' OR TG_TABLE_NAME = 'feature_permissions' THEN
    IF NOT NEW."isActive" OR (NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= clock_timestamp()) THEN RETURN NEW; END IF;
    subject_id := NEW."userId";
  ELSIF TG_TABLE_NAME = 'effective_action_grants' THEN
    IF NEW."subjectUserId" IS NULL OR NEW.domain = 'PARTNER' OR NEW.effect <> 'ALLOW' OR NEW."revokedAt" IS NOT NULL
       OR (NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= clock_timestamp()) THEN RETURN NEW; END IF;
    subject_id := NEW."subjectUserId";
  ELSIF TG_TABLE_NAME = 'sales_contracts' THEN
    IF NEW."partnerKind" = 'PARTNER_CUSTOMER' OR NEW."isInactive"
       OR NEW.status::text NOT IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED') THEN RETURN NEW; END IF;
    subject_id := NEW."responsibleSellerId";
  ELSIF TG_TABLE_NAME = 'sales_contract_edit_sessions' THEN
    subject_id := NEW."ownerUserId";
    partner_technical_session := (to_jsonb(NEW)->>'purpose' = 'PARTNER_TECHNICAL'
      AND to_jsonb(NEW)->>'contractId' IS NULL);
  ELSIF TG_TABLE_NAME = 'hr_duties' THEN
    IF NEW.status <> 'OPEN' OR NEW."currentAssigneeUserId" IS NULL THEN RETURN NEW; END IF;
    subject_id := NEW."currentAssigneeUserId";
  ELSIF TG_TABLE_NAME = 'accounting_correction_requests' THEN
    IF NEW.status <> 'OPEN' OR NEW."assignedToUserId" IS NULL THEN RETURN NEW; END IF;
    subject_id := NEW."assignedToUserId";
  ELSIF TG_TABLE_NAME IN ('partner_profile_responder_assignments', 'partner_inquiry_assignments') THEN
    subject_id := NEW."responderId";
  ELSIF TG_TABLE_NAME = 'users' THEN
    IF NEW.role::text = 'USER' THEN RETURN NEW; END IF;
    subject_id := NEW.id;
  ELSE
    RAISE EXCEPTION 'unsupported Partner persona guard table';
  END IF;

  SELECT "irreversibleAt", state::text INTO irreversible_at, profile_state
    FROM partner_profiles WHERE "userId" = subject_id FOR UPDATE;
  IF irreversible_at IS NOT NULL THEN
    IF partner_technical_session AND profile_state = 'ACTIVE' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'incompatible authority or responsibility for irreversible Partner persona'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_persona_correction_guard
  BEFORE INSERT OR UPDATE OF "assignedToUserId", status ON accounting_correction_requests
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();

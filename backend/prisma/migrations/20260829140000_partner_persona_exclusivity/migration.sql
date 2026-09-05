-- Partner persona is one-way after the first retained Partner evidence. Every
-- incompatible writer locks the Profile row used by activation, so permission,
-- responsibility and duty changes have one serial order with conversion.
CREATE OR REPLACE FUNCTION partner_reject_incompatible_persona() RETURNS trigger AS $$
DECLARE
  subject_id text;
  irreversible_at timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'workspace_permissions' OR TG_TABLE_NAME = 'feature_permissions' THEN
    IF NOT NEW."isActive" OR (NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= clock_timestamp()) THEN RETURN NEW; END IF;
    subject_id := NEW."userId";
  ELSIF TG_TABLE_NAME = 'effective_action_grants' THEN
    IF NEW."subjectUserId" IS NULL OR NEW.domain = 'PARTNER' OR NEW.effect <> 'ALLOW' OR NEW."revokedAt" IS NOT NULL
       OR NEW."effectiveFrom" > clock_timestamp() OR (NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" <= clock_timestamp()) THEN RETURN NEW; END IF;
    subject_id := NEW."subjectUserId";
  ELSIF TG_TABLE_NAME = 'sales_contracts' THEN
    IF NEW."partnerKind" = 'PARTNER_CUSTOMER' THEN RETURN NEW; END IF;
    subject_id := NEW."responsibleSellerId";
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

CREATE TRIGGER partner_persona_workspace_guard BEFORE INSERT OR UPDATE ON workspace_permissions
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
CREATE TRIGGER partner_persona_feature_guard BEFORE INSERT OR UPDATE ON feature_permissions
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
CREATE TRIGGER partner_persona_scoped_grant_guard BEFORE INSERT OR UPDATE ON effective_action_grants
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
CREATE TRIGGER partner_persona_contract_guard BEFORE INSERT OR UPDATE OF "responsibleSellerId", "partnerKind" ON sales_contracts
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
CREATE TRIGGER partner_persona_duty_guard BEFORE INSERT OR UPDATE OF "currentAssigneeUserId", status ON hr_duties
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
CREATE TRIGGER partner_persona_profile_responder_guard BEFORE INSERT ON partner_profile_responder_assignments
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
CREATE TRIGGER partner_persona_inquiry_responder_guard BEFORE INSERT ON partner_inquiry_assignments
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
CREATE TRIGGER partner_persona_role_guard BEFORE UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();

-- Any inquiry mutation takes the owning Profile lifecycle lock before it can
-- commit. Route authorization already does this; the database guard also
-- protects future/background writers and keeps termination fail closed.
CREATE OR REPLACE FUNCTION partner_lock_inquiry_profile() RETURNS trigger AS $$
DECLARE
  inquiry_id text;
  profile_id text;
BEGIN
  inquiry_id := CASE WHEN TG_TABLE_NAME = 'partner_inquiries' THEN NEW.id ELSE NEW."inquiryId" END;
  SELECT "profileId" INTO profile_id FROM partner_inquiries WHERE id = inquiry_id;
  IF profile_id IS NULL AND TG_TABLE_NAME = 'partner_inquiries' THEN profile_id := NEW."profileId"; END IF;
  IF profile_id IS NOT NULL THEN PERFORM 1 FROM partner_profiles WHERE id = profile_id FOR UPDATE; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_inquiry_profile_lifecycle_guard BEFORE INSERT OR UPDATE ON partner_inquiries
  FOR EACH ROW EXECUTE FUNCTION partner_lock_inquiry_profile();
CREATE TRIGGER partner_inquiry_row_profile_lifecycle_guard BEFORE INSERT OR UPDATE ON partner_inquiry_rows
  FOR EACH ROW EXECUTE FUNCTION partner_lock_inquiry_profile();
CREATE TRIGGER partner_inquiry_assignment_profile_lifecycle_guard BEFORE INSERT ON partner_inquiry_assignments
  FOR EACH ROW EXECUTE FUNCTION partner_lock_inquiry_profile();

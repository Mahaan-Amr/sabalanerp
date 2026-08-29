BEGIN;

ALTER TABLE crm_customers ADD COLUMN "partnerRevision" integer;
ALTER TABLE crm_potential_projects ADD COLUMN "partnerRevision" integer;
ALTER TABLE crm_next_actions ADD COLUMN "partnerRevision" integer;

UPDATE crm_customers SET "partnerRevision" = 1 WHERE "partnerOwnerProfileId" IS NOT NULL;
UPDATE crm_potential_projects project SET "partnerRevision" = 1
  FROM crm_customers customer WHERE customer.id = project."customerId" AND customer."partnerOwnerProfileId" IS NOT NULL;
UPDATE crm_next_actions action SET "partnerRevision" = 1
  FROM crm_customers customer WHERE customer.id = action."customerId" AND customer."partnerOwnerProfileId" IS NOT NULL;

ALTER TABLE crm_customers ADD CONSTRAINT partner_customer_revision_presence CHECK
  (("partnerOwnerProfileId" IS NULL AND "partnerRevision" IS NULL) OR
   ("partnerOwnerProfileId" IS NOT NULL AND "partnerRevision" IS NOT NULL AND "partnerRevision" > 0));

CREATE TYPE "PartnerCustomerTransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "PartnerCustomerTransferEventType" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

CREATE TABLE partner_duplicate_customer_matches (
  id text PRIMARY KEY,
  "requesterProfileId" text NOT NULL REFERENCES partner_profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "customerId" text NOT NULL REFERENCES crm_customers(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  snapshot jsonb NOT NULL,
  "witnessHash" text NOT NULL,
  "issuedAt" timestamptz(3) NOT NULL DEFAULT now(),
  "expiresAt" timestamptz(3) NOT NULL,
  CONSTRAINT partner_duplicate_match_window CHECK ("issuedAt" < "expiresAt"),
  CONSTRAINT partner_duplicate_match_hash CHECK ("witnessHash" ~ '^sha256-v1:[a-f0-9]{64}$')
);
CREATE INDEX partner_duplicate_customer_matches_requester_expiry_idx
  ON partner_duplicate_customer_matches("requesterProfileId", "expiresAt");
CREATE INDEX partner_duplicate_customer_matches_customer_expiry_idx
  ON partner_duplicate_customer_matches("customerId", "expiresAt");

CREATE TABLE partner_customer_transfers (
  id text PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1,
  "customerId" text NOT NULL REFERENCES crm_customers(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "matchId" text NOT NULL UNIQUE REFERENCES partner_duplicate_customer_matches(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "fromOwnerUserId" text NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "fromProfileId" text REFERENCES partner_profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "toProfileId" text NOT NULL REFERENCES partner_profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  status "PartnerCustomerTransferStatus" NOT NULL DEFAULT 'PENDING',
  "requestedBy" text NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "requestReason" text NOT NULL,
  "requestedAt" timestamptz(3) NOT NULL DEFAULT now(),
  "decidedBy" text REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  "decisionReason" text,
  "decidedAt" timestamptz(3),
  "decisionCommandId" text UNIQUE,
  "correlationId" text NOT NULL,
  CONSTRAINT partner_customer_transfer_distinct_owners CHECK (
    "fromProfileId" IS NULL OR "fromProfileId" <> "toProfileId"),
  CONSTRAINT partner_customer_transfer_revision CHECK (revision > 0),
  CONSTRAINT partner_customer_transfer_reason CHECK (length(trim("requestReason")) >= 3),
  CONSTRAINT partner_customer_transfer_decision_complete CHECK (
    (status = 'PENDING' AND revision = 1 AND "decidedBy" IS NULL AND "decisionReason" IS NULL
      AND "decidedAt" IS NULL AND "decisionCommandId" IS NULL) OR
    (status IN ('APPROVED', 'REJECTED') AND revision = 2 AND "decidedBy" IS NOT NULL
      AND length(trim("decisionReason")) >= 3 AND "decidedAt" IS NOT NULL AND "decisionCommandId" IS NOT NULL)
  )
);
CREATE INDEX partner_customer_transfers_from_status_requested_idx
  ON partner_customer_transfers("fromOwnerUserId", status, "requestedAt");
CREATE INDEX partner_customer_transfers_to_status_requested_idx
  ON partner_customer_transfers("toProfileId", status, "requestedAt");
CREATE INDEX partner_customer_transfers_customer_status_idx
  ON partner_customer_transfers("customerId", status);
CREATE UNIQUE INDEX partner_customer_one_pending_transfer
  ON partner_customer_transfers("customerId") WHERE status = 'PENDING';

CREATE TABLE partner_customer_transfer_events (
  id text PRIMARY KEY,
  "transferId" text NOT NULL REFERENCES partner_customer_transfers(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  revision integer NOT NULL,
  type "PartnerCustomerTransferEventType" NOT NULL,
  "actorId" text NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  reason text NOT NULL,
  "commandId" text NOT NULL UNIQUE,
  "correlationId" text NOT NULL,
  evidence jsonb NOT NULL,
  "recordedAt" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT partner_customer_transfer_event_revision CHECK (revision > 0),
  CONSTRAINT partner_customer_transfer_event_reason CHECK (length(trim(reason)) >= 3),
  UNIQUE ("transferId", revision)
);

CREATE TRIGGER partner_duplicate_match_append_only BEFORE UPDATE OR DELETE ON partner_duplicate_customer_matches
  FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation();
CREATE TRIGGER partner_duplicate_match_no_truncate BEFORE TRUNCATE ON partner_duplicate_customer_matches
  FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation();
CREATE TRIGGER partner_customer_transfer_event_append_only BEFORE UPDATE OR DELETE ON partner_customer_transfer_events
  FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation();
CREATE TRIGGER partner_customer_transfer_event_no_truncate BEFORE TRUNCATE ON partner_customer_transfer_events
  FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation();

CREATE FUNCTION partner_guard_customer_transfer_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Partner Customer transfer evidence is retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD.id IS DISTINCT FROM NEW.id OR OLD."customerId" IS DISTINCT FROM NEW."customerId"
    OR OLD."matchId" IS DISTINCT FROM NEW."matchId" OR OLD."fromOwnerUserId" IS DISTINCT FROM NEW."fromOwnerUserId"
    OR OLD."fromProfileId" IS DISTINCT FROM NEW."fromProfileId"
    OR OLD."toProfileId" IS DISTINCT FROM NEW."toProfileId" OR OLD."requestedBy" IS DISTINCT FROM NEW."requestedBy"
    OR OLD."requestReason" IS DISTINCT FROM NEW."requestReason" OR OLD."requestedAt" IS DISTINCT FROM NEW."requestedAt"
    OR OLD."correlationId" IS DISTINCT FROM NEW."correlationId" OR OLD.status <> 'PENDING'
    OR NEW.status NOT IN ('APPROVED', 'REJECTED') OR NEW.revision <> OLD.revision + 1
  ) THEN
    RAISE EXCEPTION 'Partner Customer transfer identity or lifecycle is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER partner_customer_transfer_guard BEFORE UPDATE OR DELETE ON partner_customer_transfers
  FOR EACH ROW EXECUTE FUNCTION partner_guard_customer_transfer_mutation();
CREATE TRIGGER partner_customer_transfer_no_truncate BEFORE TRUNCATE ON partner_customer_transfers
  FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation();

CREATE FUNCTION partner_guard_crm_owner_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  customer_id text;
  owner_profile_id text;
  owner_user_id text;
  writer_profile_id text := current_setting('sabalan.partner_crm_profile', true);
  transfer_id text := current_setting('sabalan.partner_crm_transfer', true);
  transfer_ok boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'crm_customers' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."partnerOwnerProfileId" IS NOT NULL THEN
        RAISE EXCEPTION 'Partner Customer identity is retained' USING ERRCODE = '23514';
      END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
      owner_profile_id := NEW."partnerOwnerProfileId";
    ELSE
      owner_profile_id := COALESCE(OLD."partnerOwnerProfileId", NEW."partnerOwnerProfileId");
    END IF;
    IF owner_profile_id IS NULL THEN RETURN NEW; END IF;
    IF transfer_id IS NOT NULL AND TG_OP = 'UPDATE' THEN
      SELECT EXISTS (SELECT 1 FROM partner_customer_transfers transfer
        WHERE transfer.id = transfer_id AND transfer.status = 'PENDING' AND transfer."customerId" = OLD.id
          AND transfer."fromOwnerUserId" = OLD."ownerUserId"
          AND transfer."fromProfileId" IS NOT DISTINCT FROM OLD."partnerOwnerProfileId"
          AND transfer."toProfileId" = NEW."partnerOwnerProfileId")
        INTO transfer_ok;
    END IF;
    IF transfer_ok THEN
      SELECT "userId" INTO owner_user_id FROM partner_profiles WHERE id = NEW."partnerOwnerProfileId" FOR UPDATE;
      IF NEW."ownerUserId" IS DISTINCT FROM owner_user_id
         OR NEW."partnerRevision" IS DISTINCT FROM COALESCE(OLD."partnerRevision", 0) + 1 THEN
        RAISE EXCEPTION 'Partner Customer transfer owner or revision mismatch' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."partnerOwnerProfileId" IS NULL
       AND NEW."partnerOwnerProfileId" IS NOT NULL THEN
      RAISE EXCEPTION 'Ordinary Customer ownership requires an approved Partner transfer'
        USING ERRCODE = '23514';
    END IF;
    IF writer_profile_id IS DISTINCT FROM owner_profile_id THEN
      RAISE EXCEPTION 'Partner Customer mutation requires its current owner Profile' USING ERRCODE = '23514';
    END IF;
    SELECT "userId" INTO owner_user_id FROM partner_profiles WHERE id = owner_profile_id FOR UPDATE;
    IF NEW."ownerUserId" IS DISTINCT FROM owner_user_id OR NEW."partnerOwnerProfileId" IS DISTINCT FROM owner_profile_id
       OR NEW."partnerRevision" IS NULL THEN
      RAISE EXCEPTION 'Partner Customer owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NEW."partnerRevision" <> 1 THEN
      RAISE EXCEPTION 'Partner Customer owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."partnerRevision" <> OLD."partnerRevision" + 1 THEN
      RAISE EXCEPTION 'Partner Customer owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN customer_id := OLD."customerId"; ELSE customer_id := NEW."customerId"; END IF;
  SELECT customer."partnerOwnerProfileId", profile."userId" INTO owner_profile_id, owner_user_id
    FROM crm_customers customer LEFT JOIN partner_profiles profile ON profile.id = customer."partnerOwnerProfileId"
    WHERE customer.id = customer_id FOR UPDATE OF customer;
  IF owner_profile_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- A Customer transfer does not transfer an existing Project or its work.
  -- Legacy child rows (partnerRevision NULL) retain their independent seller
  -- responsibility and continue through ordinary CRM authorization. Partner
  -- children (positive revision) remain exclusively owner-guarded below.
  IF TG_TABLE_NAME = 'crm_potential_projects' AND TG_OP = 'UPDATE' THEN
    IF OLD."partnerRevision" IS NULL AND NEW."partnerRevision" IS NULL
       AND NEW."customerId" IS NOT DISTINCT FROM OLD."customerId"
       AND NEW."responsibleSellerId" IS NOT DISTINCT FROM OLD."responsibleSellerId" THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_follow_up_reports' THEN
    IF TG_OP = 'INSERT' AND NEW."potentialProjectId" IS NOT NULL
       AND EXISTS (SELECT 1 FROM crm_potential_projects project
         WHERE project.id = NEW."potentialProjectId" AND project."customerId" = customer_id
           AND project."partnerRevision" IS NULL AND project."responsibleSellerId" = NEW."sellerId") THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_next_actions' AND TG_OP = 'INSERT' THEN
    IF NEW."potentialProjectId" IS NOT NULL AND NEW."partnerRevision" IS NULL
       AND EXISTS (SELECT 1 FROM crm_potential_projects project
         WHERE project.id = NEW."potentialProjectId" AND project."customerId" = customer_id
           AND project."partnerRevision" IS NULL AND project."responsibleSellerId" = NEW."assignedToId") THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_next_actions' AND TG_OP = 'UPDATE' THEN
    IF OLD."partnerRevision" IS NULL AND NEW."partnerRevision" IS NULL
       AND NEW."customerId" IS NOT DISTINCT FROM OLD."customerId"
       AND NEW."assignedToId" IS NOT DISTINCT FROM OLD."assignedToId" THEN
      RETURN NEW;
    END IF;
  END IF;
  IF writer_profile_id IS DISTINCT FROM owner_profile_id THEN
    RAISE EXCEPTION 'Partner CRM child mutation requires its current owner Profile' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'crm_potential_projects' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Partner Project history is retained' USING ERRCODE = '23514'; END IF;
    IF NEW."responsibleSellerId" IS DISTINCT FROM owner_user_id OR NEW."customerId" IS DISTINCT FROM customer_id
       OR NEW."partnerRevision" IS NULL THEN
      RAISE EXCEPTION 'Partner Project owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NEW."partnerRevision" <> 1 THEN
      RAISE EXCEPTION 'Partner Project owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."partnerRevision" <> OLD."partnerRevision" + 1 THEN
      RAISE EXCEPTION 'Partner Project owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'crm_follow_up_reports' THEN
    IF TG_OP <> 'INSERT' OR NEW."sellerId" IS DISTINCT FROM owner_user_id THEN
      RAISE EXCEPTION 'Partner follow-up history is append-only and owner-authored' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'crm_next_actions' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Partner next-action history is retained' USING ERRCODE = '23514'; END IF;
    IF NEW."assignedToId" IS DISTINCT FROM owner_user_id OR NEW."customerId" IS DISTINCT FROM customer_id
       OR NEW."partnerRevision" IS NULL THEN
      RAISE EXCEPTION 'Partner next action owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NEW."partnerRevision" <> 1 THEN
      RAISE EXCEPTION 'Partner next action owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."partnerRevision" <> OLD."partnerRevision" + 1 THEN
      RAISE EXCEPTION 'Partner next action owner or revision mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_customer_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customers
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();
CREATE TRIGGER partner_project_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_potential_projects
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();
CREATE TRIGGER partner_follow_up_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_follow_up_reports
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();
CREATE TRIGGER partner_next_action_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_next_actions
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();
CREATE TRIGGER partner_project_address_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON project_addresses
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();
CREATE TRIGGER partner_phone_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON phone_numbers
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();
CREATE TRIGGER partner_contact_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();
CREATE TRIGGER partner_communication_owner_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_communications
  FOR EACH ROW EXECUTE FUNCTION partner_guard_crm_owner_write();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM crm_potential_projects project
    JOIN crm_customers customer ON customer.id = project."customerId"
    JOIN partner_profiles profile ON profile.id = customer."partnerOwnerProfileId"
    WHERE project."responsibleSellerId" IS DISTINCT FROM profile."userId"
  ) OR EXISTS (
    SELECT 1 FROM crm_follow_up_reports followup
    JOIN crm_customers customer ON customer.id = followup."customerId"
    JOIN partner_profiles profile ON profile.id = customer."partnerOwnerProfileId"
    WHERE followup."sellerId" IS DISTINCT FROM profile."userId"
  ) OR EXISTS (
    SELECT 1 FROM crm_next_actions action
    JOIN crm_customers customer ON customer.id = action."customerId"
    JOIN partner_profiles profile ON profile.id = customer."partnerOwnerProfileId"
    WHERE action."assignedToId" IS DISTINCT FROM profile."userId"
  ) THEN
    RAISE EXCEPTION 'existing Partner CRM child responsibility requires explicit remediation'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;

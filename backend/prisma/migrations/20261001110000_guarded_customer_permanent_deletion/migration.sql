-- ADR-0108: audited removal of unused identity only. Existing Partner owner and transfer guards remain unchanged.
CREATE OR REPLACE FUNCTION partner_guard_crm_owner_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  customer_id text;
  owner_profile_id text;
  owner_user_id text;
  writer_profile_id text := current_setting('sabalan.partner_crm_profile', true);
  transfer_id text := current_setting('sabalan.partner_crm_transfer', true);
  reassignment_context jsonb := nullif(current_setting('sabalan.partner_crm_legacy_reassignment', true), '')::jsonb;
  transfer_ok boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'crm_customers' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."partnerOwnerProfileId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM effective_authorization_audit receipt
        WHERE receipt.id = current_setting('sabalan.crm_customer_deletion_receipt', true)
          AND receipt.domain = 'CRM' AND receipt.action = 'CUSTOMER_PERMANENT_DELETE'
          AND receipt."rootKind" = 'CUSTOMER' AND receipt."rootId" = OLD.id
          AND receipt.allowed AND receipt.code = 'DELETED' AND length(trim(receipt.reason)) >= 3
          AND receipt.xmin::text = txid_current()::text
      ) THEN
        RAISE EXCEPTION 'Partner Customer identity is retained without an audited deletion command' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM sales_contracts WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM partner_sale_cases WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM crm_leads WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM crm_communications WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM crm_potential_projects WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM crm_follow_up_reports WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM crm_next_actions WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM crm_timeline_events WHERE "customerId" = OLD.id)
        OR EXISTS (SELECT 1 FROM logistics_loadings l WHERE l."customerId" = OLD.id OR l."projectId" IN (SELECT id FROM project_addresses WHERE "customerId" = OLD.id))
        OR EXISTS (SELECT 1 FROM security_vehicle_movements m WHERE m."customerId" = OLD.id OR m."projectId" IN (SELECT id FROM project_addresses WHERE "customerId" = OLD.id))
      THEN
        RAISE EXCEPTION 'Customer history prevents permanent deletion' USING ERRCODE = '23514';
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
  IF TG_TABLE_NAME = 'crm_potential_projects' AND TG_OP = 'INSERT'
     AND (to_jsonb(NEW)->>'partnerRevision') IS NULL THEN
    PERFORM id FROM users WHERE id = to_jsonb(NEW)->>'responsibleSellerId' FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM users destination
         WHERE destination.id = to_jsonb(NEW)->>'responsibleSellerId' AND destination."isActive")
       OR EXISTS (SELECT 1 FROM partner_profiles destination_profile
         WHERE destination_profile."userId" = to_jsonb(NEW)->>'responsibleSellerId') THEN
      RAISE EXCEPTION 'Legacy CRM Project responsibility requires an active internal non-Partner User'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'crm_potential_projects' AND TG_OP = 'UPDATE'
     AND (to_jsonb(OLD)->'customerTransferSnapshot') IS DISTINCT FROM
       (to_jsonb(NEW)->'customerTransferSnapshot') THEN
    IF OLD."partnerRevision" IS NULL AND NEW."partnerRevision" IS NULL
       AND (to_jsonb(OLD)->>'customerTransferSnapshot') IS NULL
       AND (to_jsonb(NEW)->>'customerTransferSnapshot') IS NOT NULL
       AND NEW."customerId" IS NOT DISTINCT FROM OLD."customerId"
       AND NEW."responsibleSellerId" IS NOT DISTINCT FROM OLD."responsibleSellerId"
       AND transfer_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM partner_customer_transfers transfer
         WHERE transfer.id = transfer_id AND transfer.status = 'PENDING'
           AND transfer."customerId" = OLD."customerId") THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Transferred Customer witness is immutable' USING ERRCODE = '23514';
  END IF;
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
       AND NEW."responsibleSellerId" IS NOT DISTINCT FROM OLD."responsibleSellerId"
       AND (to_jsonb(NEW)->'customerTransferSnapshot') IS NOT DISTINCT FROM
         (to_jsonb(OLD)->'customerTransferSnapshot') THEN
      RETURN NEW;
    END IF;
    IF OLD."partnerRevision" IS NULL AND NEW."partnerRevision" IS NULL
       AND NEW."customerId" IS NOT DISTINCT FROM OLD."customerId"
       AND reassignment_context->>'projectId' = OLD.id
       AND reassignment_context->>'previousSellerId' = OLD."responsibleSellerId"
       AND reassignment_context->>'nextSellerId' = NEW."responsibleSellerId"
       AND (to_jsonb(NEW)->'customerTransferSnapshot') IS NOT DISTINCT FROM
         (to_jsonb(OLD)->'customerTransferSnapshot')
       AND coalesce(reassignment_context->>'actorId', '') <> ''
       AND coalesce(reassignment_context->>'reason', '') <> ''
       AND EXISTS (SELECT 1 FROM users destination
         WHERE destination.id = NEW."responsibleSellerId" AND destination."isActive")
       AND NOT EXISTS (SELECT 1 FROM partner_profiles destination_profile
         WHERE destination_profile."userId" = NEW."responsibleSellerId") THEN
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

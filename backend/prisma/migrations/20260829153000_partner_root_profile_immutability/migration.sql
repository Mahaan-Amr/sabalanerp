CREATE OR REPLACE FUNCTION partner_mark_first_owned_evidence_irreversible()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  profile_id text;
  profile_user_id text;
BEGIN
  IF TG_TABLE_NAME = 'crm_customers' THEN
    profile_id := NEW."partnerOwnerProfileId";
    IF profile_id IS NULL THEN RETURN NEW; END IF;
    SELECT "userId" INTO profile_user_id FROM partner_profiles WHERE id = profile_id FOR UPDATE;
    IF profile_user_id IS NULL OR NEW."ownerUserId" IS DISTINCT FROM profile_user_id THEN
      RAISE EXCEPTION 'Partner Customer owner must match its Profile' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD."profileId" IS DISTINCT FROM NEW."profileId" THEN
      RAISE EXCEPTION 'Partner aggregate Profile root is immutable' USING ERRCODE = '23514';
    END IF;
    profile_id := NEW."profileId";
    IF profile_id IS NULL THEN RETURN NEW; END IF;
    PERFORM id FROM partner_profiles WHERE id = profile_id FOR UPDATE;
  END IF;
  UPDATE partner_profiles SET "irreversibleAt" = COALESCE("irreversibleAt", clock_timestamp())
    WHERE id = profile_id;
  RETURN NEW;
END;
$$;

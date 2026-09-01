CREATE OR REPLACE FUNCTION partner_lock_inquiry_profile() RETURNS trigger AS $$
DECLARE
  inquiry_id text;
  profile_id text;
  profile_state text;
  remediation_profile text;
BEGIN
  inquiry_id := CASE WHEN TG_TABLE_NAME = 'partner_inquiries'
    THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'inquiryId' END;
  SELECT "profileId" INTO profile_id FROM partner_inquiries WHERE id = inquiry_id;
  IF profile_id IS NULL AND TG_TABLE_NAME = 'partner_inquiries' THEN
    profile_id := to_jsonb(NEW)->>'profileId';
  END IF;
  IF profile_id IS NOT NULL THEN
    SELECT state::text INTO profile_state FROM partner_profiles WHERE id = profile_id FOR UPDATE;
    remediation_profile := current_setting('sabalan.partner_remediation_profile', true);
    IF profile_state IN ('SUSPENDED', 'TERMINATED') AND remediation_profile IS DISTINCT FROM profile_id THEN
      RAISE EXCEPTION 'Partner profile lifecycle blocks inquiry mutation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

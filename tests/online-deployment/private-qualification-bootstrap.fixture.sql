-- PRIVATE QA BOOTSTRAP ONLY, on the exact isolated restored DB/OID.
-- NOT a canonical application migration or accepted release/slot registry.
-- Original host initializer derives INSERT parameters from its original signed
-- qualification artifact. Runtime never creates/registers targets.
CREATE TABLE private_qualification_runtime_targets (
 "qualificationId" text NOT NULL CHECK("qualificationId" ~ '^[a-f0-9]{64}$'),
 "runtimeId" text NOT NULL CHECK("runtimeId" ~ '^[a-f0-9]{64}$'),
 "nonceSha256" text NOT NULL CHECK("nonceSha256" ~ '^[a-f0-9]{64}$'),
 "releaseId" text NOT NULL,
 "imageIdentity" text NOT NULL CHECK("imageIdentity" ~ '^sha256:[a-f0-9]{64}$'),
 "scopeSha256" text NOT NULL CHECK("scopeSha256" ~ '^[a-f0-9]{64}$'),
 "targetsSha256" text NOT NULL CHECK("targetsSha256" ~ '^[a-f0-9]{64}$'),
 phase text NOT NULL DEFAULT 'ACTIVE' CHECK(phase IN ('ACTIVE','DRAINING','CLOSED')),
 PRIMARY KEY("qualificationId","runtimeId")
);
CREATE FUNCTION guard_private_qualification_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'phase') IS DISTINCT FROM (to_jsonb(OLD)-'phase')
  OR NOT((OLD.phase='ACTIVE' AND NEW.phase='DRAINING') OR(OLD.phase='DRAINING' AND NEW.phase='CLOSED'))
 THEN RAISE EXCEPTION 'PRIVATE_QUALIFICATION_TARGET_IMMUTABLE_OR_PHASE_REFUSED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER private_qualification_target_guard BEFORE UPDATE OR DELETE ON private_qualification_runtime_targets
 FOR EACH ROW EXECUTE FUNCTION guard_private_qualification_target();

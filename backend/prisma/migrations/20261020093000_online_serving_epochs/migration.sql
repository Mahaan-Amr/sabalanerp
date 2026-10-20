-- Each return to a previously retired build is a new serving epoch. The
-- original release retirement remains immutable; support promises never reset.
CREATE TABLE online_serving_epochs (
 id text PRIMARY KEY,
 "releaseId" text NOT NULL REFERENCES online_releases(id) ON DELETE RESTRICT,
 "deploymentId" text NOT NULL REFERENCES deployment_operations(id) ON DELETE RESTRICT,
 generation integer NOT NULL UNIQUE CHECK (generation > 0),
 "publicationSha256" text NOT NULL UNIQUE CHECK ("publicationSha256" ~ '^[a-f0-9]{64}$'),
 "servedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "retiredAt" timestamptz(3),
 "supportUntil" timestamptz(3),
 CHECK (("retiredAt" IS NULL AND "supportUntil" IS NULL) OR
   ("retiredAt" IS NOT NULL AND "supportUntil" IS NOT NULL AND "retiredAt">="servedAt" AND "supportUntil">="retiredAt"+interval '24 hours'))
);
CREATE UNIQUE INDEX online_serving_one_current ON online_serving_epochs ((true)) WHERE "retiredAt" IS NULL;
CREATE INDEX online_serving_release_history ON online_serving_epochs("releaseId", generation DESC);
CREATE FUNCTION sabalan_protect_online_serving_epoch() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ONLINE_SERVING_HISTORY_IMMUTABLE'; END IF;
 IF ROW(OLD.id,OLD."releaseId",OLD."deploymentId",OLD.generation,OLD."publicationSha256",OLD."servedAt")
   IS DISTINCT FROM ROW(NEW.id,NEW."releaseId",NEW."deploymentId",NEW.generation,NEW."publicationSha256",NEW."servedAt")
   OR (OLD."retiredAt" IS NOT NULL AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt")
   OR (OLD."supportUntil" IS NOT NULL AND (NEW."supportUntil" IS NULL OR NEW."supportUntil"<OLD."supportUntil")) THEN
   RAISE EXCEPTION 'ONLINE_SERVING_HISTORY_IMMUTABLE';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER online_serving_epoch_guard BEFORE UPDATE OR DELETE ON online_serving_epochs
 FOR EACH ROW EXECUTE FUNCTION sabalan_protect_online_serving_epoch();

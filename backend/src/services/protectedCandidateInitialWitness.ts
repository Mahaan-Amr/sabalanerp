/** PostgreSQL local schema-only witness: receipt SHA256 3c3301b7398ca610e162dccd7c1c405528c787f200ef69fa46c5a2f5faaec7ba. No release authority. */
export const initialCanonicalWitness={
  "defaults": [
    {
      "tablename": "online_migration_steps",
      "columnname": "createdAt",
      "expression": "CURRENT_TIMESTAMP"
    },
    {
      "tablename": "online_migration_steps",
      "columnname": "state",
      "expression": "'PENDING'::text"
    },
    {
      "tablename": "online_releases",
      "columnname": "createdAt",
      "expression": "CURRENT_TIMESTAMP"
    },
    {
      "tablename": "online_releases",
      "columnname": "phase",
      "expression": "'PREPARING'::text"
    },
    {
      "tablename": "online_runtime_slots",
      "columnname": "createdAt",
      "expression": "CURRENT_TIMESTAMP"
    },
    {
      "tablename": "online_runtime_slots",
      "columnname": "phase",
      "expression": "'PREPARED'::text"
    }
  ],
  "checks": [
    {
      "tablename": "online_migration_steps",
      "conname": "online_migration_operation_identity",
      "definition": "CHECK ((\"operationSha256\" ~ '^[a-f0-9]{64}$'::text))"
    },
    {
      "tablename": "online_migration_steps",
      "conname": "online_migration_phase",
      "definition": "CHECK ((phase = ANY (ARRAY['expand'::text, 'backfill'::text, 'activate'::text, 'contract'::text])))"
    },
    {
      "tablename": "online_migration_steps",
      "conname": "online_migration_state",
      "definition": "CHECK ((state = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'COMPLETE'::text, 'DEFERRED'::text, 'FAILED'::text, 'RECOVERY_REQUIRED'::text])))"
    },
    {
      "tablename": "online_releases",
      "conname": "online_release_browser_window",
      "definition": "CHECK (((\"retiredAt\" IS NULL) OR ((\"browserSupportUntil\" IS NOT NULL) AND (\"browserSupportUntil\" >= (\"retiredAt\" + '24:00:00'::interval)))))"
    },
    {
      "tablename": "online_releases",
      "conname": "online_release_manifest_identity",
      "definition": "CHECK (((\"manifestSha256\" ~ '^[a-f0-9]{64}$'::text) AND (\"sourceCommit\" ~ '^[a-f0-9]{40}$'::text)))"
    },
    {
      "tablename": "online_releases",
      "conname": "online_release_phase",
      "definition": "CHECK ((phase = ANY (ARRAY['PREPARING'::text, 'EXPANDING'::text, 'BACKFILLING'::text, 'ACCEPTING'::text, 'READY'::text, 'SERVING'::text, 'RETAINED'::text, 'RETIRED'::text, 'FAILED'::text, 'RECOVERY_REQUIRED'::text])))"
    },
    {
      "tablename": "online_runtime_slots",
      "conname": "online_runtime_component",
      "definition": "CHECK (((component = ANY (ARRAY['backend'::text, 'frontend'::text, 'inquiry'::text])) AND ((role <> ALL (ARRAY['control'::text, 'standalone'::text])) OR (component = 'backend'::text))))"
    },
    {
      "tablename": "online_runtime_slots",
      "conname": "online_runtime_identity",
      "definition": "CHECK (((\"nonceSha256\" ~ '^[a-f0-9]{64}$'::text) AND (\"imageIdentity\" ~ '^sha256:[a-f0-9]{64}$'::text)))"
    },
    {
      "tablename": "online_runtime_slots",
      "conname": "online_runtime_phase",
      "definition": "CHECK ((phase = ANY (ARRAY['PREPARED'::text, 'STARTING'::text, 'READY'::text, 'SERVING'::text, 'DRAINING'::text, 'STOPPED'::text, 'FAILED'::text])))"
    },
    {
      "tablename": "online_runtime_slots",
      "conname": "online_runtime_role",
      "definition": "CHECK ((role = ANY (ARRAY['candidate'::text, 'serving'::text, 'control'::text, 'standalone'::text])))"
    },
    {
      "tablename": "online_runtime_slots",
      "conname": "online_runtime_stopped_evidence",
      "definition": "CHECK (((phase = 'STOPPED'::text) = (\"stoppedAt\" IS NOT NULL)))"
    }
  ],
  "indexes": [
    {
      "name": "online_migration_steps_releaseId_stepId_key",
      "definition": "CREATE UNIQUE INDEX \"online_migration_steps_releaseId_stepId_key\" ON public.online_migration_steps USING btree (\"releaseId\", \"stepId\")",
      "predicate": null
    },
    {
      "name": "online_migration_steps_sourceMigrationName_key",
      "definition": "CREATE UNIQUE INDEX \"online_migration_steps_sourceMigrationName_key\" ON public.online_migration_steps USING btree (\"sourceMigrationName\")",
      "predicate": null
    },
    {
      "name": "online_migration_steps_state_releaseId_idx",
      "definition": "CREATE INDEX \"online_migration_steps_state_releaseId_idx\" ON public.online_migration_steps USING btree (state, \"releaseId\")",
      "predicate": null
    },
    {
      "name": "online_releases_deploymentId_key",
      "definition": "CREATE UNIQUE INDEX \"online_releases_deploymentId_key\" ON public.online_releases USING btree (\"deploymentId\")",
      "predicate": null
    },
    {
      "name": "online_releases_phase_browserSupportUntil_idx",
      "definition": "CREATE INDEX \"online_releases_phase_browserSupportUntil_idx\" ON public.online_releases USING btree (phase, \"browserSupportUntil\")",
      "predicate": null
    },
    {
      "name": "online_runtime_slots_nonceSha256_key",
      "definition": "CREATE UNIQUE INDEX \"online_runtime_slots_nonceSha256_key\" ON public.online_runtime_slots USING btree (\"nonceSha256\")",
      "predicate": null
    },
    {
      "name": "online_runtime_slots_releaseId_phase_idx",
      "definition": "CREATE INDEX \"online_runtime_slots_releaseId_phase_idx\" ON public.online_runtime_slots USING btree (\"releaseId\", phase)",
      "predicate": null
    }
  ]
} as const;

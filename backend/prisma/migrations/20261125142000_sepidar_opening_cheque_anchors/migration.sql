CREATE TABLE public.accounting_sepidar_opening_cheques (
  "bookId" text NOT NULL REFERENCES public.accounting_books(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceInstrumentId" text NOT NULL CHECK (length(btrim("sourceInstrumentId")) > 0),
  "sourceOpeningLineId" text NOT NULL CHECK (length(btrim("sourceOpeningLineId")) > 0),
  "snapshotSha256" text NOT NULL CHECK ("snapshotSha256" ~ '^[0-9a-f]{64}$'),
  "planSha256" text NOT NULL CHECK ("planSha256" ~ '^[0-9a-f]{64}$'),
  "instrumentId" text NOT NULL REFERENCES public.accounting_check_instruments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "openingEventId" text NOT NULL REFERENCES public.accounting_check_instrument_events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "openingLedgerLineId" text NOT NULL REFERENCES public.accounting_ledger_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountRials" numeric(20,0) NOT NULL CHECK ("amountRials" > 0),
  CONSTRAINT accounting_sepidar_opening_cheques_pkey PRIMARY KEY ("bookId", "sourceInstrumentId")
);

CREATE UNIQUE INDEX "accounting_sepidar_opening_cheques_instrumentId_key"
  ON public.accounting_sepidar_opening_cheques ("instrumentId");
CREATE UNIQUE INDEX "accounting_sepidar_opening_cheques_openingEventId_key"
  ON public.accounting_sepidar_opening_cheques ("openingEventId");
CREATE INDEX "accounting_sepidar_opening_cheques_openingLedgerLineId_idx"
  ON public.accounting_sepidar_opening_cheques ("openingLedgerLineId");

-- Historical cheque application requires a separate protected admission.
-- The customer receivable opening approval does not authorize this operation.
CREATE FUNCTION public.sepidar_opening_cheques_runtime_admitted(
  p_release_id text, p_book_id text, p_actor_id text, p_plan_sha256 text
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT false $$;

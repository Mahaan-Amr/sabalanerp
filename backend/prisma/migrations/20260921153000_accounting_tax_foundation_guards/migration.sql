CREATE TRIGGER "accounting_tax_rule_immutable"
BEFORE UPDATE OR DELETE ON "accounting_tax_rules"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();

CREATE TRIGGER "accounting_tax_channel_immutable"
BEFORE UPDATE OR DELETE ON "accounting_tax_submission_channels"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();

CREATE TRIGGER "accounting_vat_reconciliation_immutable"
BEFORE UPDATE OR DELETE ON "accounting_vat_reconciliations"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();

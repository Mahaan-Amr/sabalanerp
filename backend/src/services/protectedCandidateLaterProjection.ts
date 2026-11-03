import {combineCatalogComparisons, type CatalogComparison} from './protectedCandidateCatalogContract';
import {invoiceConstraintWitness} from './protectedCandidateInvoiceWitness';
/** Source-derived, partial catalog expectations; never authorizes deployment.
 * Unknown fields must prevent any claim of complete catalog qualification.
 * No observation is used as its own expected value.
 */
export type LaterFactKind='table'|'sequence'|'index'|'function'|'trigger'|'constraint'|'column';
export type LaterFact=Readonly<{kind:LaterFactKind;object:string;column?:string;before:'UNKNOWN';after:'PRESENT'|'NUMERIC_65_30'|'JSONB_NULLABLE';detail?:string}>;
export type LaterStep=Readonly<{name:string;sha256:string;facts:readonly LaterFact[];unproven:readonly string[]}>;
const raw: LaterStep[] = [
  {
    "name": "20261019010000_customer_semantic_barrier",
    "sha256": "f21138c410c8653d8fcfc46b266c4ae91e82385adb0263fa0696bad9fa36ce55",
    "facts": [
      {
        "kind": "table",
        "object": "online_financial_compatibility_barriers",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "sabalan_require_customer_source_shares",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "sabalan_protect_customer_barrier",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "customer_semantic_barrier_immutable",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "sabalan_guard_customer_credit_source",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "customer_credit_source_compatibility",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "sabalan_reject_customer_semantic_mutation",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "sabalan_guard_customer_semantic_fields",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "customer_semantic_truncate_compatibility",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS",
      "DYNAMICALLY_NAMED_TRIGGER_EXPANSION"
    ]
  },
  {
    "name": "20261019020000_hr_versioned_file_cleanup",
    "sha256": "cb25c720d02d37ad036c95583ef9ba1ba7856bcd483a62ef1c8e03930947b9a9",
    "facts": [
      {
        "kind": "column",
        "object": "hr_deletion_file_cleanups",
        "before": "UNKNOWN",
        "after": "JSONB_NULLABLE",
        "column": "versionedFileState"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261020010000_online_realtime_completion",
    "sha256": "f92e8c7dca2ef0c1798275c0e3fe3d1735aec67ef52875dd4df3fed4744df181",
    "facts": [
      {
        "kind": "table",
        "object": "online_hr_invalidation_intents",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "online_hr_invalidations_ready",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "online_realtime_batches",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "online_realtime_hr_source",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "online_realtime_commands",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "online_realtime_commands_owner",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "sabalan_guard_realtime_command",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "online_realtime_batch_guard",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "online_realtime_command_guard",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "online_hr_invalidation_guard",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261020093000_online_serving_epochs",
    "sha256": "7f4b2b3dc5f7084047409e7c59d29b8667d37a85d33920e95bc7a8f37f48eb9c",
    "facts": [
      {
        "kind": "table",
        "object": "online_serving_epochs",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "online_serving_one_current",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "online_serving_release_history",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "sabalan_protect_online_serving_epoch",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "online_serving_epoch_guard",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261021120000_attendance_effective_rest_windows",
    "sha256": "5f01ad2761a2464e85ad1f4827e7613dda22db8a8f3d9112492aea4914fb4700",
    "facts": [
      {
        "kind": "table",
        "object": "attendance_rest_policies",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "attendance_rest_assignments",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "attendance_absence_decisions",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "attendance_absence_decisions_date_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "rest_policy_clock",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261025120000_preserve_exact_fulfillment_quantities",
    "sha256": "07086e6738ba752d96358e8491b00528827cb5c8af1544f4fc34fe7828974955",
    "facts": [
      {
        "kind": "column",
        "object": "accounting_inventory_cost_evidence",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_invoice_candidate_items",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_return_evidence_consumptions",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_tax_invoice_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "contract_approved_pricing_rows",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "contractedQuantity"
      },
      {
        "kind": "column",
        "object": "contract_items",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "contract_pricing_readiness_results",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantityTotal"
      },
      {
        "kind": "column",
        "object": "delivery_products",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "deliveredQuantity"
      },
      {
        "kind": "column",
        "object": "delivery_products",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "dispatch_correction_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "dispatch_priced_allocation_events",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "inventory_valuation_evidence",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "logistics_allocation_draft_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "logistics_allocation_revision_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "logistics_loading_corrections",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "deltaQuantity"
      },
      {
        "kind": "column",
        "object": "logistics_loading_driver_allocations",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "logistics_loading_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "partner_fulfillment_lineages",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "partner_priced_allocation_events",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "shipment_quantity_evidence",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "shipment_quantity_projections",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "availableToLoad"
      },
      {
        "kind": "column",
        "object": "shipment_quantity_projections",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "contracted"
      },
      {
        "kind": "column",
        "object": "shipment_quantity_projections",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "finalizedReserved"
      },
      {
        "kind": "column",
        "object": "shipment_quantity_projections",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "physicallyDispatched"
      },
      {
        "kind": "column",
        "object": "shipment_statement_migration_evidence",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "afterQuantityTotal"
      },
      {
        "kind": "column",
        "object": "shipment_statement_migration_evidence",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "beforeQuantityTotal"
      },
      {
        "kind": "column",
        "object": "logistics_loading_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "khatRas"
      },
      {
        "kind": "column",
        "object": "logistics_loading_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "pieceCount"
      },
      {
        "kind": "column",
        "object": "logistics_loading_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "plus"
      },
      {
        "kind": "column",
        "object": "logistics_loading_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "minus"
      },
      {
        "kind": "column",
        "object": "logistics_loading_driver_allocations",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "khatRas"
      },
      {
        "kind": "column",
        "object": "logistics_loading_driver_allocations",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "pieceCount"
      },
      {
        "kind": "column",
        "object": "logistics_loading_driver_allocations",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "plus"
      },
      {
        "kind": "column",
        "object": "logistics_loading_driver_allocations",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "minus"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261028090000_sales_dispatch_invoices",
    "sha256": "7ae25295e7ad168a8481dc350a8bd6cc677fc2a869ad4c934503fc7b41821c66",
    "facts": [
      {
        "kind": "sequence",
        "object": "sales_dispatch_invoice_number_seq",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "sales_dispatch_invoices",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "sales_dispatch_invoices_number_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "sales_dispatch_invoices_loadingId_requestKey_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "sales_dispatch_invoices_active_loading",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "sales_dispatch_invoices_loadingId_issuedAt_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "protect_sales_dispatch_invoice",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "protect_sales_dispatch_invoice",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "sales_dispatch_invoice_void_complete",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261028093000_sales_invoice_evidence_constraints",
    "sha256": "7f02ab81a3c9aeee1f04455ff7a8e7d223f3de9fb4dd472036871e121685a719",
    "facts": [
      {
        "kind": "constraint",
        "object": "sales_invoice_number_positive",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "sales_invoice_hashes",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "sales_invoice_explicit_void_reason",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS",
      "PREEXISTING_INVOICE_DATA_SATISFIES_930_CHECKS"
    ]
  },
  {
    "name": "20261028100000_sales_invoice_correction_evidence",
    "sha256": "351034a7c0584e26ee149567f57f9e86bdaeeeba0325ff870a2ffaacf46dfbec",
    "facts": [
      {
        "kind": "table",
        "object": "sales_invoice_corrections",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "protect_sales_invoice_correction",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "protect_sales_invoice_correction",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261031130000_purchasing_operational_workspace",
    "sha256": "16f16342572d47dee3627a27609666008619e9b748843b63d8bfb14a7e2689c5",
    "facts": [
      {
        "kind": "table",
        "object": "purchasing_documents",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "purchasing_links",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "purchasing_events",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "purchasing_commands",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "purchasing_suppliers",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "table",
        "object": "purchasing_existing_evidence",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_documents_number_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_documents_kind_status_createdAt_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_documents_contractId_kind_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_documents_creatorId_kind_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_documents_ownerId_kind_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_documents_parentId_kind_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_links_targetId_purpose_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_links_sourceId_targetId_purpose_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_events_actorId_createdAt_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_events_documentId_version_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_commands_actorId_key_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_suppliers_identityKey_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_suppliers_customerId_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_suppliers_accountingPartyId_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_existing_evidence_documentId_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_existing_evidence_sourceType_sourceId_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "function",
        "object": "purchasing_reject_evidence_mutation",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "purchasing_events_append_only",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "purchasing_existing_evidence_append_only",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "purchasing_commands_append_only",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_exchange_order_lookup",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "purchasing_documents_pkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "purchasing_links_pkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "purchasing_events_pkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "purchasing_commands_pkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "purchasing_suppliers_pkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "purchasing_existing_evidence_pkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261101160000_supply_chain_exact_purchase_quantities",
    "sha256": "3060d9534e03fbfa4191fe7755bc4121c207b0f43cae051e942414d945dc1dad",
    "facts": [
      {
        "kind": "column",
        "object": "accounting_supplier_invoice_lines",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_inventory_events",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_inventory_valuation_layers",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_inventory_layer_consumptions",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_inventory_reservations",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_production_cost_pools",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "basisQuantity"
      },
      {
        "kind": "column",
        "object": "accounting_production_outputs",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      },
      {
        "kind": "column",
        "object": "accounting_inventory_migration_items",
        "before": "UNKNOWN",
        "after": "NUMERIC_65_30",
        "column": "quantity"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261101170000_purchasing_private_attachments",
    "sha256": "6c564dffad127a402ca6bbec87e57695d501b4f2b7b87427d6fd16e3e7ee84a9",
    "facts": [
      {
        "kind": "table",
        "object": "purchasing_attachments",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_attachments_document_sha_key",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "index",
        "object": "purchasing_attachments_document_created_idx",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "trigger",
        "object": "purchasing_attachments_append_only",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  },
  {
    "name": "20261102120000_accounting_financial_approval_receipts",
    "sha256": "d8ee324f20554891f7b276725326f07ac22658cf8180af0d70baf95f9e54f378",
    "facts": [
      {
        "kind": "table",
        "object": "accounting_financial_approval_receipts",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "accounting_financial_approval_receipts_pkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      },
      {
        "kind": "constraint",
        "object": "accounting_financial_approval_receipts_financialRecordId_fkey",
        "before": "UNKNOWN",
        "after": "PRESENT"
      }
    ],
    "unproven": [
      "BASELINE_EXISTENCE_AND_DATA",
      "COMPLETE_COLUMNS_TYPES_DEFAULTS",
      "CONSTRAINT_DEFINITIONS_AND_VALIDATION",
      "INDEX_DEFINITIONS_AND_PREDICATES",
      "TRIGGER_FUNCTION_BODIES_AND_BINDINGS",
      "EXTRA_OBJECTS_AND_SUCCESSOR_EFFECTS"
    ]
  }
];
export const protectedCandidateLaterProjection:readonly LaterStep[]=Object.freeze(raw.map(step=>Object.freeze({...step,facts:Object.freeze(step.facts.map(f=>Object.freeze(f))),unproven:Object.freeze([...step.unproven])})));
export const invoiceConstraintDependency=Object.freeze({before:'20261028090000_sales_dispatch_invoices',after:'20261028093000_sales_invoice_evidence_constraints'});
export type LaterObserved=Readonly<{exists:boolean;type?:string;precision?:number;scale?:number;nullable?:boolean}>;
/** Positive partial facts remain UNKNOWN until all object semantics are proven. */
export function compareLaterFact(fact:LaterFact,observed:LaterObserved):CatalogComparison{
 if(!observed || typeof observed.exists!=='boolean')return 'UNKNOWN';
 if(!observed.exists)return 'MISMATCH';
 if(fact.after==='PRESENT')return combineCatalogComparisons(['MATCH','UNKNOWN']);
 if(typeof observed.type!=='string')return 'UNKNOWN';
 if(fact.after==='JSONB_NULLABLE'){if(typeof observed.nullable!=='boolean')return 'UNKNOWN';return observed.type.toLowerCase()==='jsonb'&&observed.nullable?combineCatalogComparisons(['MATCH','UNKNOWN']):'MISMATCH';}
 if(!Number.isInteger(observed.precision)||!Number.isInteger(observed.scale))return 'UNKNOWN';
 return ['numeric','decimal'].includes(observed.type.toLowerCase())&&observed.precision===65&&observed.scale===30?combineCatalogComparisons(['MATCH','UNKNOWN']):'MISMATCH';
}
/** Result covers only name, public schema, native numeric type OID and typmod.
 * It is not qualification of nullability, defaults, constraints or authority. */
export async function observeLaterNumericColumns(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},stage:string):Promise<Readonly<{coverage:'numeric_type_oid_typmod';count:number;comparison:CatalogComparison}>>{
 const result=(count:number,comparison:CatalogComparison)=>Object.freeze({coverage:'numeric_type_oid_typmod' as const,count,comparison});
 const selected=protectedCandidateLaterProjection.find(step=>step.name===stage);
 if(!selected||!tx||typeof tx.$queryRaw!=='function')return result(0,'UNKNOWN');
 const facts=selected.facts.filter(f=>f.kind==='column'&&f.after==='NUMERIC_65_30');
 if(!facts.length)return result(0,'UNKNOWN');
 for(const fact of facts){
  if(typeof fact.column!=='string'||!fact.column)return result(facts.length,'UNKNOWN');
  const rows=await tx.$queryRaw<Array<{typeOid:number;typmod:number}>>`SELECT a.atttypid::integer AS "typeOid",a.atttypmod::integer AS typmod
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname=${fact.object} AND a.attname=${fact.column} AND a.attnum>0 AND NOT a.attisdropped`;
  if(!Array.isArray(rows)||rows.length>1)return result(facts.length,'UNKNOWN');
  if(rows.length===0)return result(facts.length,'MISMATCH');
  if(!Number.isInteger(rows[0].typeOid)||!Number.isInteger(rows[0].typmod))return result(facts.length,'UNKNOWN');
  if(rows[0].typeOid!==1700||rows[0].typmod!==((65<<16)+30+4))return result(facts.length,'MISMATCH');
 }
 return result(facts.length,'MATCH');
}
/** Only the pinned JSONB ADD COLUMN is covered; no claim is made about other
 * columns, table constraints or complete catalog qualification. */
export async function observeLaterAddedColumns(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},stage:string){
 const facts=protectedCandidateLaterProjection.find(step=>step.name===stage)?.facts.filter(f=>f.kind==='column'&&f.after==='JSONB_NULLABLE')??[];
 const result=(comparison:CatalogComparison)=>Object.freeze({coverage:'public_added_jsonb_column' as const,count:facts.length,comparison});
 if(!facts.length||!tx||typeof tx.$queryRaw!=='function')return result('UNKNOWN');
 for(const fact of facts){
  if(typeof fact.column!=='string'||!fact.column)return result('UNKNOWN');
  const rows=await tx.$queryRaw<Array<{typeOid:number;typmod:number;notNull:boolean;identity:string;generated:string;hasDefault:boolean}>>`
   SELECT a.atttypid::integer AS "typeOid",a.atttypmod::integer AS typmod,a.attnotnull AS "notNull",
    a.attidentity::text AS identity,a.attgenerated::text AS generated,a.atthasdef AS "hasDefault"
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=${fact.object}
    AND c.relkind IN ('r','p') AND a.attname=${fact.column} AND a.attnum>0 AND NOT a.attisdropped`;
  if(!Array.isArray(rows)||rows.length>1)return result('UNKNOWN');
  if(rows.length===0)return result('MISMATCH');
  const row=rows[0];
  if(!Number.isInteger(row.typeOid)||!Number.isInteger(row.typmod)||typeof row.notNull!=='boolean'||typeof row.identity!=='string'||typeof row.generated!=='string'||typeof row.hasDefault!=='boolean')return result('UNKNOWN');
  if(row.typeOid!==3802||row.typmod!==-1||row.notNull||row.identity!==''||row.generated!==''||row.hasDefault)return result('MISMATCH');
 }
 return result('MATCH');
}
/** Exact PostgreSQL-15.18 CHECK definitions observed after the pinned invoice
 * constraint stage. A different server version remains UNKNOWN, not MATCH.
 * This dimension never grants permission to mutate or resume a migration. */
export async function observeInvoiceConstraintDimension(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},stage:string){
 const result=(comparison:CatalogComparison)=>Object.freeze({coverage:'invoice_three_check_definitions_pg150018' as const,count:3,comparison});
 if(stage!=='20261028093000_sales_invoice_evidence_constraints'||!tx||typeof tx.$queryRaw!=='function')return result('UNKNOWN');
 const version=await tx.$queryRaw<Array<{version:string}>>`SELECT current_setting('server_version_num') AS version`;
 if(!Array.isArray(version)||version.length!==1||version[0].version!=='150018')return result('UNKNOWN');
 const rows=await tx.$queryRaw<Array<{name:string;type:string;validated:boolean;deferrable:boolean;deferred:boolean;definition:string}>>`
  SELECT k.conname AS name,k.contype::text AS type,k.convalidated AS validated,k.condeferrable AS deferrable,
   k.condeferred AS deferred,pg_catalog.pg_get_constraintdef(k.oid) AS definition
  FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='sales_dispatch_invoices'
   AND k.conname IN ('sales_invoice_number_positive','sales_invoice_hashes','sales_invoice_explicit_void_reason')`;
 if(!Array.isArray(rows)||rows.length>3)return result('UNKNOWN');if(rows.length!==3)return result('MISMATCH');
 const expected=new Map<string,typeof invoiceConstraintWitness[number]>(invoiceConstraintWitness.map(row=>[row.conname,row]));
 for(const row of rows){const wanted=expected.get(row.name);if(!wanted||row.type!=='c'||row.validated!==true||row.deferrable!==false||row.deferred!==false||row.definition!==wanted.definition)return result('MISMATCH');expected.delete(row.name);}
 return result(expected.size?'MISMATCH':'MATCH');
}
/** Exact column declarations transcribed from the pinned CREATE TABLE sources.
 * These describe source declarations, not the complete post-migration catalog.
 */
export type LaterColumnExpectation=Readonly<{stage:string;table:string;column:string;typeDeclaration:string;nullable:boolean;defaultSource:string|null;before:'UNKNOWN'}>;
const sourceColumns:LaterColumnExpectation[]=[
  {
    "stage": "20261019010000_customer_semantic_barrier",
    "table": "online_financial_compatibility_barriers",
    "column": "capability",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261019010000_customer_semantic_barrier",
    "table": "online_financial_compatibility_barriers",
    "column": "state",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261019010000_customer_semantic_barrier",
    "table": "online_financial_compatibility_barriers",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "event",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "originRuntimeId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "originNonceSha256",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "sourceOutcome",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": "'PREPARED'",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "deliveryStatus",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": "'PENDING'",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "sourceSettledAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "deliverySettledAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_hr_invalidation_intents",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": false,
    "defaultSource": "clock_timestamp()",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "kind",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "sourceId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "notificationId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "userId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "producerRuntimeId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "producerNonceSha256",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "targetsSha256",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "targetsJson",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_batches",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": false,
    "defaultSource": "clock_timestamp()",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "batchId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "runtimeId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "nonceSha256",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "releaseId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "imageIdentity",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "status",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": "'PENDING'",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "claimToken",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "startedAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "settledAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "table": "online_realtime_commands",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": false,
    "defaultSource": "clock_timestamp()",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "releaseId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "deploymentId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "generation",
    "typeDeclaration": "INTEGER",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "publicationSha256",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "servedAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": false,
    "defaultSource": "clock_timestamp()",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "retiredAt",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "table": "online_serving_epochs",
    "column": "supportUntil",
    "typeDeclaration": "TIMESTAMPTZ(3)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_policies",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_policies",
    "column": "effectiveFrom",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_policies",
    "column": "startTime",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_policies",
    "column": "endTime",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_policies",
    "column": "createdBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_policies",
    "column": "reason",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_policies",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_assignments",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_assignments",
    "column": "personnelId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_assignments",
    "column": "effectiveFrom",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_assignments",
    "column": "hasRest",
    "typeDeclaration": "BOOLEAN",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_assignments",
    "column": "createdBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_assignments",
    "column": "reason",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_rest_assignments",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "personnelId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "date",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "evidenceHash",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "createdBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "reason",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "evidence",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "table": "attendance_absence_decisions",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "number",
    "typeDeclaration": "BIGINT",
    "nullable": false,
    "defaultSource": "nextval('sales_dispatch_invoice_number_seq')",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "loadingId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "requestKey",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "sourceHash",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "snapshot",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "pdf",
    "typeDeclaration": "BYTEA",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "pdfSha256",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "issuedAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "issuedBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "voidedAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "voidedBy",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "voidReason",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "table": "sales_dispatch_invoices",
    "column": "replacesId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028100000_sales_invoice_correction_evidence",
    "table": "sales_invoice_corrections",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028100000_sales_invoice_correction_evidence",
    "table": "sales_invoice_corrections",
    "column": "correctionId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028100000_sales_invoice_correction_evidence",
    "table": "sales_invoice_corrections",
    "column": "snapshot",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028100000_sales_invoice_correction_evidence",
    "table": "sales_invoice_corrections",
    "column": "integrityHash",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028100000_sales_invoice_correction_evidence",
    "table": "sales_invoice_corrections",
    "column": "recordedAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028100000_sales_invoice_correction_evidence",
    "table": "sales_invoice_corrections",
    "column": "recordedBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "number",
    "typeDeclaration": "SERIAL",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "kind",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "version",
    "typeDeclaration": "INTEGER",
    "nullable": false,
    "defaultSource": "1",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "status",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": "'OPEN'",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "ownerId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "creatorId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "contractId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "customerId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "parentId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "data",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_documents",
    "column": "updatedAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "sourceId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "targetId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "purpose",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "quantity",
    "typeDeclaration": "DECIMAL(65,30)",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "unit",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "data",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_links",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "documentId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "version",
    "typeDeclaration": "INTEGER",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "actorId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "action",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "data",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "previousHash",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "entryHash",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_events",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_commands",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_commands",
    "column": "actorId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_commands",
    "column": "key",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_commands",
    "column": "hash",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_commands",
    "column": "result",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_commands",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "identityKey",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "customerId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "accountingPartyId",
    "typeDeclaration": "TEXT",
    "nullable": true,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "name",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "contact",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "isActive",
    "typeDeclaration": "BOOLEAN",
    "nullable": false,
    "defaultSource": "true",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "createdBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_suppliers",
    "column": "updatedAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "documentId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "sourceType",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "sourceId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "sourceHash",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "snapshot",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "createdBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "table": "purchasing_existing_evidence",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "id",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "documentId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "originalName",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "mimeType",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "size",
    "typeDeclaration": "INTEGER",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "sha256",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "visibility",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "bytes",
    "typeDeclaration": "BYTEA",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "scanStatus",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "createdBy",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "table": "purchasing_attachments",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261102120000_accounting_financial_approval_receipts",
    "table": "accounting_financial_approval_receipts",
    "column": "financialRecordId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261102120000_accounting_financial_approval_receipts",
    "table": "accounting_financial_approval_receipts",
    "column": "actorId",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261102120000_accounting_financial_approval_receipts",
    "table": "accounting_financial_approval_receipts",
    "column": "idempotencyKey",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261102120000_accounting_financial_approval_receipts",
    "table": "accounting_financial_approval_receipts",
    "column": "payloadHash",
    "typeDeclaration": "TEXT",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261102120000_accounting_financial_approval_receipts",
    "table": "accounting_financial_approval_receipts",
    "column": "response",
    "typeDeclaration": "JSONB",
    "nullable": false,
    "defaultSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261102120000_accounting_financial_approval_receipts",
    "table": "accounting_financial_approval_receipts",
    "column": "createdAt",
    "typeDeclaration": "TIMESTAMP(3)",
    "nullable": false,
    "defaultSource": "CURRENT_TIMESTAMP",
    "before": "UNKNOWN"
  }
];
export const protectedCandidateCreatedColumns:readonly LaterColumnExpectation[]=Object.freeze(sourceColumns.map(column=>Object.freeze(column)));
/** Partial native column evidence for the exact most recently completed stage.
 * Non-null default expressions are only checked for presence until a reviewed
 * PostgreSQL deparse witness establishes their exact semantics. */
export async function observeLaterCreatedColumns(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},stage:string){
 const expected=protectedCandidateCreatedColumns.filter(column=>column.stage===stage);
 const answer=(structure:CatalogComparison,defaults:CatalogComparison)=>Object.freeze({coverage:'public_column_type_null_identity_generated_default_presence' as const,count:expected.length,structure,defaults});
 if(!tx||typeof tx.$queryRaw!=='function'||!expected.length)return answer('UNKNOWN','UNKNOWN');
 const types:Readonly<Record<string,readonly [number,number]>>={TEXT:[25,-1],'TIMESTAMPTZ(3)':[1184,3],JSONB:[3802,-1],INTEGER:[23,-1],
  'TIMESTAMP(3)':[1114,3],BOOLEAN:[16,-1],BIGINT:[20,-1],BYTEA:[17,-1],SERIAL:[23,-1],'DECIMAL(65,30)':[1700,(65<<16)+30+4]};
 let defaultsUnknown=false;
 for(const column of expected){
  const wanted=types[column.typeDeclaration];if(!wanted)return answer('UNKNOWN','UNKNOWN');
  const rows=await tx.$queryRaw<Array<{typeOid:number;typmod:number;notNull:boolean;identity:string;generated:string;hasDefault:boolean}>>`
   SELECT a.atttypid::integer AS "typeOid",a.atttypmod::integer AS typmod,a.attnotnull AS "notNull",
    a.attidentity::text AS identity,a.attgenerated::text AS generated,a.atthasdef AS "hasDefault"
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname=${column.table} AND c.relkind IN ('r','p')
    AND a.attname=${column.column} AND a.attnum>0 AND NOT a.attisdropped`;
  if(!Array.isArray(rows)||rows.length>1)return answer('UNKNOWN','UNKNOWN');
  if(rows.length===0)return answer('MISMATCH','UNKNOWN');
  const row=rows[0];
  if(!Number.isInteger(row.typeOid)||!Number.isInteger(row.typmod)||typeof row.notNull!=='boolean'||typeof row.identity!=='string'||typeof row.generated!=='string'||typeof row.hasDefault!=='boolean')return answer('UNKNOWN','UNKNOWN');
  if(row.typeOid!==wanted[0]||row.typmod!==wanted[1]||row.notNull===column.nullable||row.identity!==''||row.generated!=='')return answer('MISMATCH','UNKNOWN');
  const expectsDefault=column.defaultSource!==null||column.typeDeclaration==='SERIAL';
  if(row.hasDefault!==expectsDefault)return answer('UNKNOWN','MISMATCH');
  if(expectsDefault)defaultsUnknown=true;
 }
 return answer('MATCH',defaultsUnknown?'UNKNOWN':'MATCH');
}
export type LaterObservedColumn=Readonly<{exists:boolean;typeDeclaration?:string;nullable?:boolean;defaultSource?:string|null}>;
/** Type/nullability checks are source-level; canonical default equality must be independently qualified. */
export function compareCreatedColumn(expected:LaterColumnExpectation,actual:LaterObservedColumn):CatalogComparison{
 if(!actual||typeof actual.exists!=='boolean')return 'UNKNOWN';
 if(!actual.exists)return 'MISMATCH';
 if(typeof actual.typeDeclaration!=='string'||typeof actual.nullable!=='boolean')return 'UNKNOWN';
 const norm=(s:string)=>s.toUpperCase().replace(/\s+/g,'').replace(/^TIMESTAMP(\(\d+\))?WITHTIMEZONE$/, 'TIMESTAMPTZ$1').replace(/^TIMESTAMP(\(\d+\))?WITHOUTTIMEZONE$/, 'TIMESTAMP$1');
 if(actual.nullable!==expected.nullable)return 'MISMATCH';
 const expectedType=norm(expected.typeDeclaration),actualType=norm(actual.typeDeclaration);
 if(actualType!==expectedType){const e=/^(TIMESTAMP|TIMESTAMPTZ)\((\d+)\)$/.exec(expectedType),a=/^(TIMESTAMP|TIMESTAMPTZ)\((\d+)\)$/.exec(actualType);return e&&a?'MISMATCH':'UNKNOWN';}
 if(expected.defaultSource===null){if(actual.defaultSource===undefined)return 'UNKNOWN';return actual.defaultSource===null?combineCatalogComparisons(['MATCH','UNKNOWN']):'MISMATCH';}
 // PostgreSQL rewrites default expressions; source text equality is not proof.
 return 'UNKNOWN';
}
/** Index clauses are source-derived, including uniqueness, keys and predicates. */
export type LaterIndexExpectation=Readonly<{stage:string;name:string;table:string;unique:boolean;keysSource:string;predicateSource:string|null;before:'UNKNOWN'}>;
const sourceIndexes:LaterIndexExpectation[]=[
  {
    "stage": "20261020010000_online_realtime_completion",
    "name": "online_hr_invalidations_ready",
    "table": "online_hr_invalidation_intents",
    "unique": false,
    "keysSource": "\"sourceOutcome\",\"deliveryStatus\",\"createdAt\",id",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "name": "online_realtime_hr_source",
    "table": "online_realtime_batches",
    "unique": true,
    "keysSource": "kind,\"sourceId\"",
    "predicateSource": "kind='HR_PERSONNEL_INVALIDATION'",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "name": "online_realtime_commands_owner",
    "table": "online_realtime_commands",
    "unique": false,
    "keysSource": "\"runtimeId\",\"nonceSha256\",status,\"createdAt\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "name": "online_serving_one_current",
    "table": "online_serving_epochs",
    "unique": true,
    "keysSource": "(true)",
    "predicateSource": "\"retiredAt\" IS NULL",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "name": "online_serving_release_history",
    "table": "online_serving_epochs",
    "unique": false,
    "keysSource": "\"releaseId\", generation DESC",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261021120000_attendance_effective_rest_windows",
    "name": "attendance_absence_decisions_date_idx",
    "table": "attendance_absence_decisions",
    "unique": false,
    "keysSource": "\"date\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "name": "sales_dispatch_invoices_number_key",
    "table": "sales_dispatch_invoices",
    "unique": true,
    "keysSource": "number",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "name": "sales_dispatch_invoices_loadingId_requestKey_key",
    "table": "sales_dispatch_invoices",
    "unique": true,
    "keysSource": "\"loadingId\", \"requestKey\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "name": "sales_dispatch_invoices_active_loading",
    "table": "sales_dispatch_invoices",
    "unique": true,
    "keysSource": "\"loadingId\"",
    "predicateSource": "\"voidedAt\" IS NULL",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "name": "sales_dispatch_invoices_loadingId_issuedAt_idx",
    "table": "sales_dispatch_invoices",
    "unique": false,
    "keysSource": "\"loadingId\", \"issuedAt\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_documents_number_key",
    "table": "purchasing_documents",
    "unique": true,
    "keysSource": "\"number\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_documents_kind_status_createdAt_idx",
    "table": "purchasing_documents",
    "unique": false,
    "keysSource": "\"kind\", \"status\", \"createdAt\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_documents_contractId_kind_idx",
    "table": "purchasing_documents",
    "unique": false,
    "keysSource": "\"contractId\", \"kind\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_documents_creatorId_kind_idx",
    "table": "purchasing_documents",
    "unique": false,
    "keysSource": "\"creatorId\", \"kind\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_documents_ownerId_kind_idx",
    "table": "purchasing_documents",
    "unique": false,
    "keysSource": "\"ownerId\", \"kind\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_documents_parentId_kind_idx",
    "table": "purchasing_documents",
    "unique": false,
    "keysSource": "\"parentId\", \"kind\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_links_targetId_purpose_idx",
    "table": "purchasing_links",
    "unique": false,
    "keysSource": "\"targetId\", \"purpose\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_links_sourceId_targetId_purpose_key",
    "table": "purchasing_links",
    "unique": true,
    "keysSource": "\"sourceId\", \"targetId\", \"purpose\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_events_actorId_createdAt_idx",
    "table": "purchasing_events",
    "unique": false,
    "keysSource": "\"actorId\", \"createdAt\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_events_documentId_version_key",
    "table": "purchasing_events",
    "unique": true,
    "keysSource": "\"documentId\", \"version\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_commands_actorId_key_key",
    "table": "purchasing_commands",
    "unique": true,
    "keysSource": "\"actorId\", \"key\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_suppliers_identityKey_key",
    "table": "purchasing_suppliers",
    "unique": true,
    "keysSource": "\"identityKey\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_suppliers_customerId_key",
    "table": "purchasing_suppliers",
    "unique": true,
    "keysSource": "\"customerId\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_suppliers_accountingPartyId_key",
    "table": "purchasing_suppliers",
    "unique": true,
    "keysSource": "\"accountingPartyId\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_existing_evidence_documentId_idx",
    "table": "purchasing_existing_evidence",
    "unique": false,
    "keysSource": "\"documentId\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_existing_evidence_sourceType_sourceId_key",
    "table": "purchasing_existing_evidence",
    "unique": true,
    "keysSource": "\"sourceType\", \"sourceId\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_exchange_order_lookup",
    "table": "purchasing_documents",
    "unique": false,
    "keysSource": "(data->>'orderId')",
    "predicateSource": "kind = 'EXCHANGE'",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "name": "purchasing_attachments_document_sha_key",
    "table": "purchasing_attachments",
    "unique": true,
    "keysSource": "\"documentId\",sha256",
    "predicateSource": null,
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "name": "purchasing_attachments_document_created_idx",
    "table": "purchasing_attachments",
    "unique": false,
    "keysSource": "\"documentId\",\"createdAt\"",
    "predicateSource": null,
    "before": "UNKNOWN"
  }
];
export const protectedCandidateCreatedIndexes:readonly LaterIndexExpectation[]=Object.freeze(sourceIndexes.map(index=>Object.freeze(index)));
/** Checks only public index/table binding, btree, uniqueness and readiness.
 * Key expressions, order, collations, operator classes and predicate remain
 * unqualified until independently matched against the pinned SQL. */
export async function observeLaterCreatedIndexes(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},stage:string){
 const expected=protectedCandidateCreatedIndexes.filter(index=>index.stage===stage);
 let keys:CatalogComparison='MATCH',predicate:CatalogComparison='MATCH';
 const result=(structure:CatalogComparison)=>Object.freeze({coverage:'public_index_binding_btree_unique_readiness_keys' as const,count:expected.length,structure,keys,predicate});
 if(!expected.length||!tx||typeof tx.$queryRaw!=='function'){keys='UNKNOWN';predicate='UNKNOWN';return result('UNKNOWN');}
 for(const index of expected){
  const rows=await tx.$queryRaw<Array<{table:string;method:string;unique:boolean;valid:boolean;ready:boolean;keyNames:string[];options:number[];defaultOpclasses:boolean[];columnCollations:boolean[];noExpressions:boolean;noIncludes:boolean;nullsNotDistinct:boolean;hasPredicate:boolean}>>`
   SELECT c.relname AS "table",am.amname AS method,i.indisunique AS "unique",i.indisvalid AS valid,i.indisready AS ready,
    (i.indexprs IS NULL) AS "noExpressions",(i.indnatts=i.indnkeyatts) AS "noIncludes",i.indnullsnotdistinct AS "nullsNotDistinct",(i.indpred IS NOT NULL) AS "hasPredicate",
    ARRAY(SELECT a.attname::text FROM generate_series(0,i.indnkeyatts-1) x(pos) LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[x.pos] ORDER BY x.pos) AS "keyNames",
    ARRAY(SELECT i.indoption[x.pos]::integer FROM generate_series(0,i.indnkeyatts-1) x(pos) ORDER BY x.pos) AS options,
    ARRAY(SELECT COALESCE(o.opcdefault AND o.opcmethod=ix.relam,false) FROM generate_series(0,i.indnkeyatts-1) x(pos) LEFT JOIN pg_catalog.pg_opclass o ON o.oid=i.indclass[x.pos] ORDER BY x.pos) AS "defaultOpclasses",
    ARRAY(SELECT COALESCE(a.attcollation=i.indcollation[x.pos],false) FROM generate_series(0,i.indnkeyatts-1) x(pos) LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[x.pos] ORDER BY x.pos) AS "columnCollations"
   FROM pg_catalog.pg_class ix JOIN pg_catalog.pg_namespace n ON n.oid=ix.relnamespace
   JOIN pg_catalog.pg_index i ON i.indexrelid=ix.oid JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
   JOIN pg_catalog.pg_namespace cn ON cn.oid=c.relnamespace JOIN pg_catalog.pg_am am ON am.oid=ix.relam
   WHERE n.nspname='public' AND cn.nspname='public' AND ix.relname=${index.name}`;
  if(!Array.isArray(rows)||rows.length>1)return result('UNKNOWN');if(rows.length===0)return result('MISMATCH');
  const row=rows[0];if(typeof row.table!=='string'||typeof row.method!=='string'||typeof row.unique!=='boolean'||typeof row.valid!=='boolean'||typeof row.ready!=='boolean')return result('UNKNOWN');
  if(row.table!==index.table||row.method!=='btree'||row.unique!==index.unique||!row.valid||!row.ready)return result('MISMATCH');
  if(typeof row.hasPredicate!=='boolean'||typeof row.noExpressions!=='boolean'||typeof row.noIncludes!=='boolean'||typeof row.nullsNotDistinct!=='boolean'||!Array.isArray(row.keyNames)||!Array.isArray(row.options)||!Array.isArray(row.defaultOpclasses)||!Array.isArray(row.columnCollations)){keys='UNKNOWN';predicate='UNKNOWN';continue;}
  if(row.hasPredicate!==(index.predicateSource!==null))return result('MISMATCH');
  if(index.predicateSource!==null)predicate='UNKNOWN';
  const parts=index.keysSource.split(',').map(part=>/^\s*(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))(?:\s+(ASC|DESC))?\s*$/i.exec(part));
  if(parts.some(part=>!part)){keys='UNKNOWN';continue;}
  const names=parts.map(part=>part![1]??part![2]),options=parts.map(part=>part![3]?.toUpperCase()==='DESC'?3:0);
  if(!row.noExpressions||!row.noIncludes||row.nullsNotDistinct||JSON.stringify(row.keyNames)!==JSON.stringify(names)||JSON.stringify(row.options)!==JSON.stringify(options)||row.defaultOpclasses.length!==names.length||row.columnCollations.length!==names.length||row.defaultOpclasses.some(v=>v!==true)||row.columnCollations.some(v=>v!==true)){keys='MISMATCH';return result('MISMATCH');}
 }
 return result('MATCH');
}
export type LaterObservedIndex=Readonly<{exists:boolean;table?:string;unique?:boolean;keysSource?:string;predicateSource?:string|null;valid?:boolean;ready?:boolean;accessMethod?:string;collations?:readonly string[];operatorClasses?:readonly string[]}>;
/** Different SQL renderings are UNKNOWN, not proof of changed semantics. */
export function compareCreatedIndex(expected:LaterIndexExpectation,actual:LaterObservedIndex):CatalogComparison{
 if(!actual||typeof actual.exists!=='boolean')return 'UNKNOWN';
 if(!actual.exists)return 'MISMATCH';
 if(typeof actual.table!=='string'||typeof actual.unique!=='boolean')return 'UNKNOWN';
 if(actual.table!==expected.table||actual.unique!==expected.unique)return 'MISMATCH';
 if(actual.valid===false||actual.ready===false)return 'MISMATCH';
 if(actual.valid!==true||actual.ready!==true||typeof actual.accessMethod!=='string'||!Array.isArray(actual.collations)||!Array.isArray(actual.operatorClasses))return 'UNKNOWN';
 if(typeof actual.keysSource!=='string'||actual.predicateSource===undefined)return 'UNKNOWN';
 const n=(s:string)=>s.replace(/\s+/g,' ').trim();
 if(n(actual.keysSource)!==n(expected.keysSource))return 'UNKNOWN';
 if(expected.predicateSource===null)return actual.predicateSource===null?'UNKNOWN':'MISMATCH';
 if(actual.predicateSource===null)return 'MISMATCH';
 // Access method, collation and operator class expectations are unresolved.
 return 'UNKNOWN';
}
/** Static trigger clauses only; dynamic trigger names remain explicitly unproven. */
export type LaterTriggerExpectation=Readonly<{stage:string;name:string;table:string;timing:string;events:readonly string[];level:string;function:string;before:'UNKNOWN'}>;
const sourceTriggers:LaterTriggerExpectation[]=[
  {
    "stage": "20261019010000_customer_semantic_barrier",
    "name": "customer_semantic_barrier_immutable",
    "table": "online_financial_compatibility_barriers",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "INSERT",
      "TRUNCATE",
      "UPDATE"
    ],
    "level": "STATEMENT",
    "function": "sabalan_protect_customer_barrier",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261019010000_customer_semantic_barrier",
    "name": "customer_credit_source_compatibility",
    "table": "accounting_settlement_allocations",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "INSERT",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "sabalan_guard_customer_credit_source",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261019010000_customer_semantic_barrier",
    "name": "customer_semantic_truncate_compatibility",
    "table": "accounting_settlement_allocations",
    "timing": "BEFORE",
    "events": [
      "TRUNCATE"
    ],
    "level": "STATEMENT",
    "function": "sabalan_reject_customer_semantic_mutation",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "name": "online_realtime_batch_guard",
    "table": "online_realtime_batches",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "sabalan_guard_realtime_command",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "name": "online_realtime_command_guard",
    "table": "online_realtime_commands",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "sabalan_guard_realtime_command",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020010000_online_realtime_completion",
    "name": "online_hr_invalidation_guard",
    "table": "online_hr_invalidation_intents",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "sabalan_guard_realtime_command",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261020093000_online_serving_epochs",
    "name": "online_serving_epoch_guard",
    "table": "online_serving_epochs",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "sabalan_protect_online_serving_epoch",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028090000_sales_dispatch_invoices",
    "name": "protect_sales_dispatch_invoice",
    "table": "sales_dispatch_invoices",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "protect_sales_dispatch_invoice",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261028100000_sales_invoice_correction_evidence",
    "name": "protect_sales_invoice_correction",
    "table": "sales_invoice_corrections",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "protect_sales_invoice_correction",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_events_append_only",
    "table": "purchasing_events",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "purchasing_reject_evidence_mutation",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_existing_evidence_append_only",
    "table": "purchasing_existing_evidence",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "purchasing_reject_evidence_mutation",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261031130000_purchasing_operational_workspace",
    "name": "purchasing_commands_append_only",
    "table": "purchasing_commands",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "purchasing_reject_evidence_mutation",
    "before": "UNKNOWN"
  },
  {
    "stage": "20261101170000_purchasing_private_attachments",
    "name": "purchasing_attachments_append_only",
    "table": "purchasing_attachments",
    "timing": "BEFORE",
    "events": [
      "DELETE",
      "UPDATE"
    ],
    "level": "ROW",
    "function": "purchasing_reject_evidence_mutation",
    "before": "UNKNOWN"
  }
];
export const protectedCandidateCreatedTriggers:readonly LaterTriggerExpectation[]=Object.freeze(sourceTriggers.map(value=>Object.freeze({...value,events:Object.freeze([...value.events])})));
export type LaterObservedTrigger=Readonly<{exists:boolean;table?:string;timing?:string;events?:readonly string[];level?:string;function?:string;enabledMode?:'ORIGIN'|'ALWAYS'|'REPLICA'|'DISABLED';functionSchema?:string;functionSignature?:string}>;
/** Checks binding and enablement; does not establish function body equivalence. */
export function compareCreatedTrigger(expected:LaterTriggerExpectation,actual:LaterObservedTrigger):CatalogComparison{
 if(!actual||typeof actual.exists!=='boolean')return 'UNKNOWN';if(!actual.exists)return 'MISMATCH';
 if(typeof actual.table!=='string'||typeof actual.timing!=='string'||!Array.isArray(actual.events)||typeof actual.level!=='string'||typeof actual.function!=='string'||typeof actual.enabledMode!=='string'||typeof actual.functionSchema!=='string'||typeof actual.functionSignature!=='string')return 'UNKNOWN';
 if(actual.table!==expected.table||actual.timing!==expected.timing||actual.level!==expected.level||actual.function!==expected.function||actual.enabledMode!=='ORIGIN'||JSON.stringify([...actual.events].sort())!==JSON.stringify([...expected.events].sort()))return 'MISMATCH';
 // Function schema, identity and body are not yet independently qualified.
 return 'UNKNOWN';
}
export const protectedCandidateLaterCatalogQualification='UNKNOWN' as const;

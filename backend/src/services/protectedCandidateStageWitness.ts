/** Synthetic schema rollback witness; hashes are scoped observations, never admission. */
export const candidateStageWitness={
  "format": "sabalan-local-schema-stage-witness/v1",
  "receiptSha256": "18433ae4f0246cf147e1afc35add6491c0d6d5e0055417ac020bd7d9d1804e4b",
  "settings": {
    "server_version_num": "150018",
    "date_style": "ISO, MDY",
    "interval_style": "postgres",
    "standard_conforming_strings": "on",
    "search_path": "\"$user\", public",
    "timezone": "UTC",
    "client_encoding": "UTF8",
    "server_encoding": "UTF8",
    "database_collation": "en_US.utf8",
    "database_ctype": "en_US.utf8"
  },
  "stages": [
    {
      "name": "20261014140000_online_deployment_control",
      "sqlSha256": "872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2",
      "coverage": {
        "tables": [
          "online_migration_steps",
          "online_releases",
          "online_runtime_slots"
        ],
        "functions": [
          "sabalan_prevent_online_registry_delete",
          "sabalan_protect_online_migration_identity",
          "sabalan_protect_online_release_identity",
          "sabalan_protect_online_runtime_identity"
        ],
        "indexes": [
          "online_releases_deploymentId_key",
          "online_releases_phase_browserSupportUntil_idx",
          "online_runtime_slots_nonceSha256_key",
          "online_runtime_slots_releaseId_phase_idx",
          "online_migration_steps_sourceMigrationName_key",
          "online_migration_steps_state_releaseId_idx",
          "online_migration_steps_releaseId_stepId_key"
        ],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "online_migration_steps": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "online_releases": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "online_runtime_slots": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {
          "sabalan_prevent_online_registry_delete": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          "sabalan_protect_online_migration_identity": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          "sabalan_protect_online_release_identity": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          "sabalan_protect_online_runtime_identity": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        }
      },
      "after": {
        "tables": {
          "online_migration_steps": "9544c8fc6e690cb42e74550a39f4461787d5484e2179595c6581cb51b163a8f2",
          "online_releases": "1848be690e6e0bca185a2de034a259a13df6118e8b962ca69deafb28e97f163c",
          "online_runtime_slots": "e0f59020e57919880390a81340003a7961bfbc839a75fce557d801ce675840ab"
        },
        "functions": {
          "sabalan_prevent_online_registry_delete": "e31d20ac55c007dad0128b5ad25ce1f1fdb5f29e901bd825e6151fa2ff9649bd",
          "sabalan_protect_online_migration_identity": "e92a690ffd0aefd0c4f93e00249d4cb2c8c3fb65fe63bb4c2a8113d96bd991c3",
          "sabalan_protect_online_release_identity": "c142381e3a24f381cd8bcc57d3e75a43bf959761af77a11421c7c0b5e528a161",
          "sabalan_protect_online_runtime_identity": "fbc1302f0adc106fb470588713c594ece44d5b64e894e6e7c4733af4c612ae01"
        }
      }
    },
    {
      "name": "20261019010000_customer_semantic_barrier",
      "sqlSha256": "f21138c410c8653d8fcfc46b266c4ae91e82385adb0263fa0696bad9fa36ce55",
      "coverage": {
        "tables": [
          "accounting_check_instrument_events",
          "accounting_check_instruments",
          "accounting_customer_commands",
          "accounting_customer_opening_attributions",
          "accounting_customer_opening_reviews",
          "accounting_customer_receipt_adjustments",
          "accounting_customer_receipt_resolutions",
          "accounting_settlement_allocation_lines",
          "accounting_settlement_allocations",
          "accounting_treasury_transactions",
          "online_financial_compatibility_barriers"
        ],
        "functions": [
          "sabalan_guard_customer_credit_source",
          "sabalan_guard_customer_semantic_fields",
          "sabalan_protect_customer_barrier",
          "sabalan_reject_customer_semantic_mutation",
          "sabalan_require_customer_source_shares"
        ],
        "indexes": [],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "accounting_check_instrument_events": "511d34a3131332848e2a6476f6e1aa925b0822125db7376bde57c02b5a6b43a5",
          "accounting_check_instruments": "af86bde69ba0093ca67f313c1d2e2ba174b24179e527c41c573de89fc2d5c65b",
          "accounting_customer_commands": "8af194e3b5ffca830710cf084a5d6089cad582072d96a20efc972dcd43c95d46",
          "accounting_customer_opening_attributions": "0f44565623fec0010538c38f96e707372c40c73fbea7aba62d03c826cebbaf76",
          "accounting_customer_opening_reviews": "2ded9c37fdb3aff5bfcbeb2165bddfee26737f9dcba8227d797443eed1cbefab",
          "accounting_customer_receipt_adjustments": "1fb1580e7ddbe1acc618491b884a210a5a35239a6de88b27bddf075c7d2b039f",
          "accounting_customer_receipt_resolutions": "badba69d23eeb459a285eccae684d835bc195b16e7b0f6f2e52b2389d1db15c5",
          "accounting_settlement_allocation_lines": "1d34911dba5fc29712d353e11a2f5fbeca9658df460b60757d4d75d53dd99a3d",
          "accounting_settlement_allocations": "9424153da2b4ed60cca3fd05d00a12f350a99705046ee27a16ee9a94da097c7a",
          "accounting_treasury_transactions": "5e4552f68b094f2744fb1911e5ea663184762b6afb4251ac75a471ede412f5cd",
          "online_financial_compatibility_barriers": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {
          "sabalan_guard_customer_credit_source": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          "sabalan_guard_customer_semantic_fields": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          "sabalan_protect_customer_barrier": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          "sabalan_reject_customer_semantic_mutation": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          "sabalan_require_customer_source_shares": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        }
      },
      "after": {
        "tables": {
          "accounting_check_instrument_events": "6ccec6fdf86c3365df664efb6e30129633dcc7e3a5a2fc58524dea2d2e0b8b4e",
          "accounting_check_instruments": "ed0cb6b5eb38d73bf04776b78826fbe503ac11b6666e39cd544be9d2b841b66e",
          "accounting_customer_commands": "7418f6320fbd4090924026e7fcedb7078b66bf3826d0b8d7ad95b8d1904ed964",
          "accounting_customer_opening_attributions": "472682286d863dd9c8ed5d7a1ffbe454e77c5c86a13e338ee2e4dc66d64999bb",
          "accounting_customer_opening_reviews": "2ef44fbd1c4d7d98681ff016fe7786988bbedda907aeb28e8d4a5a0424b663ba",
          "accounting_customer_receipt_adjustments": "ed7ead509466415746d4e026263e85e2e2480548beb9a296bf602b943bd8d62e",
          "accounting_customer_receipt_resolutions": "a7ad9796c544f8fa2ecbe06e9eb9399bf7454f8d9877701210285ada2e380c0d",
          "accounting_settlement_allocation_lines": "16eb41b739300be0bbb9f2ce2457f30c411a22c2ea1e754a7ca098d57ee63973",
          "accounting_settlement_allocations": "4f6388efdcfacbf995b1f15c559a739b96f1a3e7c740dd18ae2154cc13f7d8c7",
          "accounting_treasury_transactions": "bf7a3eed174a6500b59c65224fa9c8317f6445c3dfd3d025d0b37c77ad934e62",
          "online_financial_compatibility_barriers": "f2e559cfc055b842431b707aeca3b777cc7551195d53c897421c8ebd68c1a61c"
        },
        "functions": {
          "sabalan_guard_customer_credit_source": "b2b9df48ebd14eb8ca41e9695f2b0fe16accc5adba34cbaf7865e6a0c23a2af5",
          "sabalan_guard_customer_semantic_fields": "8cbb920defe746dcc1153ae6d8aadfe0935e11a489b688032a4177c55c53e884",
          "sabalan_protect_customer_barrier": "f0ac002e54193de61ad8cda7c930dc70e9c24cbc95ad713aacc69b0b82597463",
          "sabalan_reject_customer_semantic_mutation": "37af1d1f2270958b1d3637ae1c7b90fa3e60224bc7488f5f2ae5f23455004b84",
          "sabalan_require_customer_source_shares": "ff1e562e8d28f4550d42f32eb8def8788acde32e65a90974c0f5a2937ab177e2"
        }
      }
    },
    {
      "name": "20261019020000_hr_versioned_file_cleanup",
      "sqlSha256": "cb25c720d02d37ad036c95583ef9ba1ba7856bcd483a62ef1c8e03930947b9a9",
      "coverage": {
        "tables": [
          "hr_deletion_file_cleanups"
        ],
        "functions": [],
        "indexes": [],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "hr_deletion_file_cleanups": "609bae92002b0a1cbab44792ac021561ed3bd3d9d260fd36b761d85cd53ffa62"
        },
        "functions": {}
      },
      "after": {
        "tables": {
          "hr_deletion_file_cleanups": "59355b6549996a09f1334ce894887ad05933bac4dbfd5afcdd445c8f3783d9c8"
        },
        "functions": {}
      }
    },
    {
      "name": "20261020010000_online_realtime_completion",
      "sqlSha256": "f92e8c7dca2ef0c1798275c0e3fe3d1735aec67ef52875dd4df3fed4744df181",
      "coverage": {
        "tables": [
          "online_hr_invalidation_intents",
          "online_realtime_batches",
          "online_realtime_commands"
        ],
        "functions": [
          "sabalan_guard_realtime_command"
        ],
        "indexes": [
          "online_hr_invalidations_ready",
          "online_realtime_hr_source",
          "online_realtime_commands_owner"
        ],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "online_hr_invalidation_intents": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "online_realtime_batches": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "online_realtime_commands": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {
          "sabalan_guard_realtime_command": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        }
      },
      "after": {
        "tables": {
          "online_hr_invalidation_intents": "5918cd59f5965da1ad83133d84c9ab9ba96bbc84b840c1dbdd71a0765d00b7b4",
          "online_realtime_batches": "c2e5c92eff2edac2aab9470a71aa8b154f7b5786b4e68b8321c72ea2e5396805",
          "online_realtime_commands": "e57d70523cd63aa18190fc8a7745a9fc6961d8c5fe5a9c8f276f3eacc174d676"
        },
        "functions": {
          "sabalan_guard_realtime_command": "b9d8641080e614f2e6e9f741d88df6834bc6edfe956da58e5e829cee3b19aac5"
        }
      }
    },
    {
      "name": "20261020093000_online_serving_epochs",
      "sqlSha256": "7f4b2b3dc5f7084047409e7c59d29b8667d37a85d33920e95bc7a8f37f48eb9c",
      "coverage": {
        "tables": [
          "online_serving_epochs"
        ],
        "functions": [
          "sabalan_protect_online_serving_epoch"
        ],
        "indexes": [
          "online_serving_one_current",
          "online_serving_release_history"
        ],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "online_serving_epochs": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {
          "sabalan_protect_online_serving_epoch": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        }
      },
      "after": {
        "tables": {
          "online_serving_epochs": "9b8d563619789bae6d3750b7dd2b3b7d34c0e03c98d31db51fd7fc862cf9dcb4"
        },
        "functions": {
          "sabalan_protect_online_serving_epoch": "3de28d974937148c74f94837ada1c72f662702b23d5d7f05e26cfe44c99cc7c5"
        }
      }
    },
    {
      "name": "20261021120000_attendance_effective_rest_windows",
      "sqlSha256": "5f01ad2761a2464e85ad1f4827e7613dda22db8a8f3d9112492aea4914fb4700",
      "coverage": {
        "tables": [
          "attendance_absence_decisions",
          "attendance_rest_assignments",
          "attendance_rest_policies"
        ],
        "functions": [],
        "indexes": [
          "attendance_absence_decisions_date_idx"
        ],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "attendance_absence_decisions": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "attendance_rest_assignments": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "attendance_rest_policies": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {}
      },
      "after": {
        "tables": {
          "attendance_absence_decisions": "ae63885f54b0c2d8ec88623197350d8241b33c9cdf0d6a12f344e473272c6703",
          "attendance_rest_assignments": "f237f29dc60561d6bbfe9d7e9d12351d657249d9cbdf1b228e7f98dce8820aa1",
          "attendance_rest_policies": "67304664e09dd5067b1d32864c27f8c1a1bc8bccee43eeb0fa99a55b49609b26"
        },
        "functions": {}
      }
    },
    {
      "name": "20261025120000_preserve_exact_fulfillment_quantities",
      "sqlSha256": "07086e6738ba752d96358e8491b00528827cb5c8af1544f4fc34fe7828974955",
      "coverage": {
        "tables": [
          "accounting_inventory_cost_evidence",
          "accounting_invoice_candidate_items",
          "accounting_return_evidence_consumptions",
          "accounting_tax_invoice_lines",
          "contract_approved_pricing_rows",
          "contract_items",
          "contract_pricing_readiness_results",
          "delivery_products",
          "dispatch_correction_lines",
          "dispatch_priced_allocation_events",
          "inventory_valuation_evidence",
          "logistics_allocation_draft_lines",
          "logistics_allocation_revision_lines",
          "logistics_loading_corrections",
          "logistics_loading_driver_allocations",
          "logistics_loading_lines",
          "partner_fulfillment_lineages",
          "partner_priced_allocation_events",
          "shipment_quantity_evidence",
          "shipment_quantity_projections",
          "shipment_statement_migration_evidence"
        ],
        "functions": [],
        "indexes": [],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "accounting_inventory_cost_evidence": "e59c02092fcf1d378da61d112ad5b841651e0267e34e196bd1275968758bc78e",
          "accounting_invoice_candidate_items": "9df0ac55daddd9b047bac9b3f30eb07798972a174e2d20eba575abdba3f225c6",
          "accounting_return_evidence_consumptions": "254ccc41ee60c215c9b47d548136d1281236de6b8a5c93084df7f2952ef90c27",
          "accounting_tax_invoice_lines": "bdc6c523424248bee7d6d6f7d714558366a8acb7640103eb97b0315abaec1e93",
          "contract_approved_pricing_rows": "a3f1b59e7f190cb811c4bae675d058444eaa6f9c8e418e1eaec91912785dbdf3",
          "contract_items": "f406af939d1298cf53f5e287e9105e1a1c14e305508bd5b0ec85bb28b0fc697a",
          "contract_pricing_readiness_results": "4b29bc91b5f7e2644f9e7cc5905f6f649a73b5bb9495234558b2ed28dd0934af",
          "delivery_products": "e496f143c29846a5eade0757b15900e85d5b8c05fba6ecdf060b86cb6a279f76",
          "dispatch_correction_lines": "775d1aa5c3cd4f10a864e94557845009253bcbe1c873f0d5ec848aa0db7b191f",
          "dispatch_priced_allocation_events": "9976c41cac1b9208e822787cb6c3705a9a0bd0353784f3a8caf10332bc6e5f5a",
          "inventory_valuation_evidence": "6c02c845a3a7736eeb343510513d2ab0553d596e7a8b25f6adf00758986ed321",
          "logistics_allocation_draft_lines": "57ff2cc92918fd3411dce98a020798ea828b32ce4b731f57cc4f1c06f19de9a4",
          "logistics_allocation_revision_lines": "a3145d104b36459757cb2af0261e9254b89d0909d7946a4d08514ee6a16fbaeb",
          "logistics_loading_corrections": "583e72083dc86cb7ef76d02a0e7c54478ded7f0d4784cf15fffc05b9140b9fa4",
          "logistics_loading_driver_allocations": "f19e106ec9d5121b6ef196fe9f0a26a310a6f22f8f612e1c47d56e5e1b7e4c7e",
          "logistics_loading_lines": "89dff068a9d6855687f5b3806950c28c13cfc0008a91960ae9d0524eaefdd9fa",
          "partner_fulfillment_lineages": "f088a53bc9ae3d464f50f0631b6d85bdbcc666197931e6e7a8f654e4556fa121",
          "partner_priced_allocation_events": "b5154fc632de8f1e7565620a89cec101e5de65a91d870a64d0a70e0e29298ac4",
          "shipment_quantity_evidence": "01976d6d323ae026bcca6c708d5ec961ae76d7ea8517cd9fca7cab28302faa9f",
          "shipment_quantity_projections": "5b4412b86de8251384a748a7e15e9b59a6d2d2a69594deff5316c6a91338b32c",
          "shipment_statement_migration_evidence": "3fc8372b806ad21d7100e80509c83075852fa466637057769a5dafd2930fbf66"
        },
        "functions": {}
      },
      "after": {
        "tables": {
          "accounting_inventory_cost_evidence": "86f3dafb57e9987ac519d582aff218b80b30855c3cd8ca1ee83ecf4f0f3af8f6",
          "accounting_invoice_candidate_items": "f34cb95e2af5bb8a88888f8513299a7c64fa48ff2b660c94c6254502a0fe3eb2",
          "accounting_return_evidence_consumptions": "247095c6b07a73403c82e68757a72a2ad1e75d3392ac99aed350271fcd661e0b",
          "accounting_tax_invoice_lines": "1df5fc8684df42b882497b2e4e14d8ad025e918e972f0c34d101b52a21db64a6",
          "contract_approved_pricing_rows": "52df615fa93e8e9a45301589b298aedc7febe940b32e3c02f7108235746b9e7d",
          "contract_items": "ac92a7b9bce2eae2aeab94ab2638693729e1bb1d53c67c0f1931f1e05b6cfadd",
          "contract_pricing_readiness_results": "fc0afb022507f48522d246dde50cb2017b0aadd77a7cb08a88c48caf04b62bfa",
          "delivery_products": "4d2b05ee07e735efdcf51f8f8503b99032bca460caec11d289f9f5779eeed95f",
          "dispatch_correction_lines": "8c620aff8559bc1c40b93f0e7b8e4a8d0767cbd046bf08e63a5e9d241a5d6511",
          "dispatch_priced_allocation_events": "624917be0afc7fe6f89e72443f7a2b177a5825c19b105287508d195a83ca3df3",
          "inventory_valuation_evidence": "14c8ed3ac653b03e4681c42cfeeed82d92d7b51a23ce0d511aa3726092c10ce2",
          "logistics_allocation_draft_lines": "1aad12b124de90536540d9daf784f5eb246743a8241ade450efb121c8a4bc985",
          "logistics_allocation_revision_lines": "fbec3d3f5e2a7240d1d18a35df42c9cfb5f006aa6d821a414005f894c7f94148",
          "logistics_loading_corrections": "f60a77826f25d26778906e02dc4f3721c481f3d09f66741db1493803366fecee",
          "logistics_loading_driver_allocations": "d0a4db1b040c0c3f9506d113b5566652b97056a1aae538aad1e7d3618e713031",
          "logistics_loading_lines": "90415b25dc1ba2f90a26f666eed5b3d68d76a9afec3c2b89399ed8bc54c1c0a0",
          "partner_fulfillment_lineages": "d699c2f4c82598211796aaacb824ad68a1f6289a9ab88dec60d4e97b0d2d815b",
          "partner_priced_allocation_events": "ede69dd7b83d4146d40d01d8a0720ffc948cdf04017c2063507bd49652c5daa2",
          "shipment_quantity_evidence": "f17557d0fa2a487fd2fde714322e2f001c17673f514b83254a473dbf8b0f61d5",
          "shipment_quantity_projections": "df120df30744e61f8201d470ff981aa5f4982346609b639a0edd3aa26b1d5aed",
          "shipment_statement_migration_evidence": "b99da7bdbe91071f42e1d87b41bdff3201633ad09b02dadf475d59460e6b1203"
        },
        "functions": {}
      }
    },
    {
      "name": "20261028090000_sales_dispatch_invoices",
      "sqlSha256": "7ae25295e7ad168a8481dc350a8bd6cc677fc2a869ad4c934503fc7b41821c66",
      "coverage": {
        "tables": [
          "sales_dispatch_invoices"
        ],
        "functions": [
          "protect_sales_dispatch_invoice"
        ],
        "indexes": [
          "sales_dispatch_invoices_number_key",
          "sales_dispatch_invoices_loadingId_requestKey_key",
          "sales_dispatch_invoices_active_loading",
          "sales_dispatch_invoices_loadingId_issuedAt_idx"
        ],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "sales_dispatch_invoices": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {
          "protect_sales_dispatch_invoice": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        }
      },
      "after": {
        "tables": {
          "sales_dispatch_invoices": "f3b8d4939ecf30f6a4b7892f6ed37239066a6b8e4b48cf8229ee323d3f6b6365"
        },
        "functions": {
          "protect_sales_dispatch_invoice": "125226235a493897955575fca5bf3df7f0f4bd0dcc5250f0349e359cb293b33f"
        }
      }
    },
    {
      "name": "20261028093000_sales_invoice_evidence_constraints",
      "sqlSha256": "7f02ab81a3c9aeee1f04455ff7a8e7d223f3de9fb4dd472036871e121685a719",
      "coverage": {
        "tables": [
          "sales_dispatch_invoices"
        ],
        "functions": [],
        "indexes": [],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "sales_dispatch_invoices": "f3b8d4939ecf30f6a4b7892f6ed37239066a6b8e4b48cf8229ee323d3f6b6365"
        },
        "functions": {}
      },
      "after": {
        "tables": {
          "sales_dispatch_invoices": "5ec51c5b9b7327c2be75f5155a824c432955326d7a7b689eba3adc5a329d0470"
        },
        "functions": {}
      }
    },
    {
      "name": "20261028100000_sales_invoice_correction_evidence",
      "sqlSha256": "351034a7c0584e26ee149567f57f9e86bdaeeeba0325ff870a2ffaacf46dfbec",
      "coverage": {
        "tables": [
          "sales_invoice_corrections"
        ],
        "functions": [
          "protect_sales_invoice_correction"
        ],
        "indexes": [],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "sales_invoice_corrections": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {
          "protect_sales_invoice_correction": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        }
      },
      "after": {
        "tables": {
          "sales_invoice_corrections": "91a6a432950db24d982fc514499a7d254923e563cba34f9faf4ebfc06d14fdfe"
        },
        "functions": {
          "protect_sales_invoice_correction": "8e1016afe8faf83e2f222f6b478f014fbced635a7f80d199228d10aab28328e6"
        }
      }
    },
    {
      "name": "20261031130000_purchasing_operational_workspace",
      "sqlSha256": "16f16342572d47dee3627a27609666008619e9b748843b63d8bfb14a7e2689c5",
      "coverage": {
        "tables": [
          "purchasing_commands",
          "purchasing_documents",
          "purchasing_events",
          "purchasing_existing_evidence",
          "purchasing_links",
          "purchasing_suppliers"
        ],
        "functions": [
          "purchasing_reject_evidence_mutation"
        ],
        "indexes": [
          "purchasing_documents_number_key",
          "purchasing_documents_kind_status_createdAt_idx",
          "purchasing_documents_contractId_kind_idx",
          "purchasing_documents_creatorId_kind_idx",
          "purchasing_documents_ownerId_kind_idx",
          "purchasing_documents_parentId_kind_idx",
          "purchasing_links_targetId_purpose_idx",
          "purchasing_links_sourceId_targetId_purpose_key",
          "purchasing_events_actorId_createdAt_idx",
          "purchasing_events_documentId_version_key",
          "purchasing_commands_actorId_key_key",
          "purchasing_suppliers_identityKey_key",
          "purchasing_suppliers_customerId_key",
          "purchasing_suppliers_accountingPartyId_key",
          "purchasing_existing_evidence_documentId_idx",
          "purchasing_existing_evidence_sourceType_sourceId_key",
          "purchasing_exchange_order_lookup"
        ],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "purchasing_commands": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "purchasing_documents": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "purchasing_events": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "purchasing_existing_evidence": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "purchasing_links": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05",
          "purchasing_suppliers": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {
          "purchasing_reject_evidence_mutation": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        }
      },
      "after": {
        "tables": {
          "purchasing_commands": "749cbed521bd4b10a265e4f02cc6498df2e53ecc1ca2c1a61e17f2e50e74f600",
          "purchasing_documents": "9e22ae282f627139ce07f4df75a2376045bfe60465cd0382f1eeec2f92c0ac79",
          "purchasing_events": "32e6028c0a1612bd4bff07118645e1a4cb93a71d24b27d5f76d69f4963c14955",
          "purchasing_existing_evidence": "9c296befa5330414948d688a16231ff8cd1191bc0def3f189606a23c28e4a860",
          "purchasing_links": "6997a2311883a2926b93c462afd4ea086a02b4ec6045a92df8416cd0f76fa81d",
          "purchasing_suppliers": "264010e6c59c510dc8523e7142adc9a8fa9539a5516e811b31c432218d4fd8a5"
        },
        "functions": {
          "purchasing_reject_evidence_mutation": "9e8a510f30acebe83deb6bc4e044578b53bc08b32ad577759fbaa8c2400c8d74"
        }
      }
    },
    {
      "name": "20261101160000_supply_chain_exact_purchase_quantities",
      "sqlSha256": "3060d9534e03fbfa4191fe7755bc4121c207b0f43cae051e942414d945dc1dad",
      "coverage": {
        "tables": [
          "accounting_inventory_events",
          "accounting_inventory_layer_consumptions",
          "accounting_inventory_migration_items",
          "accounting_inventory_reservations",
          "accounting_inventory_valuation_layers",
          "accounting_production_cost_pools",
          "accounting_production_outputs",
          "accounting_supplier_invoice_lines"
        ],
        "functions": [],
        "indexes": [],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "accounting_inventory_events": "5aa69b3d4bd6c0231bec35018a7dff8257b3828b17db9ec59ed5a229d93d0e26",
          "accounting_inventory_layer_consumptions": "ee22c7501e55ffcc2b0d2095d36c011caa5203ae35da3f05fae84f85cdc2b5e8",
          "accounting_inventory_migration_items": "db6593b007fc587d40c3a94ed82ab8458c9e23ca5c15d9cebaf4d7a5fba319ce",
          "accounting_inventory_reservations": "1d78c654a876c8bace8a9bad09644fe22f12e3bc0c946e5d3ec0dc2fb52c1f6a",
          "accounting_inventory_valuation_layers": "da5f877f87500531ecb0b812871d67fa2fb27572da60631679e1ffad328161ff",
          "accounting_production_cost_pools": "f12c380ad1a84249e82bb8c827275404c0cc11221d0f31ae2872b39ad73dbba7",
          "accounting_production_outputs": "63b7f9e3f98d740f645e8924e39fe6b02d574964941b55f6702108ba66327f76",
          "accounting_supplier_invoice_lines": "88725bc4abe4fad65af9dcc80990fd68fb8da66b0bd70ff07d71e09bbbf166cd"
        },
        "functions": {}
      },
      "after": {
        "tables": {
          "accounting_inventory_events": "d3e10b5a8ef2791778b6a4e4873cdc57f2431e617295a11168ef4e34ad417f09",
          "accounting_inventory_layer_consumptions": "59e37e13f8009dc043d9fdfc15b7f6625d02aed01cb93616abe2319668320f83",
          "accounting_inventory_migration_items": "ce5bf3ac5d946a1fcc7f8dcaa0d7f1ac145182e860c36b77e5e9f680e42898e2",
          "accounting_inventory_reservations": "ac337b0dec92b546a4d024605cb1682ffabadf81abd226abac2caa6aea9ff681",
          "accounting_inventory_valuation_layers": "38c22d1da6aa569494caa2447ec2b05d641b646ccc9d8fde9cb9fe4042614712",
          "accounting_production_cost_pools": "8dbc4fd11a0260a1ce4deb28fcba1eabc32a69030e827e1c87737f107c5816ce",
          "accounting_production_outputs": "5f761ee2e25168059ae17e96ed5d6eb19ed3c0bf7afd06eba930c2b74fcdd1a2",
          "accounting_supplier_invoice_lines": "7d6a3728d86b642ae5733aa1fd0f3f5e3ba492a72408188daf13d961ddef81e6"
        },
        "functions": {}
      }
    },
    {
      "name": "20261101170000_purchasing_private_attachments",
      "sqlSha256": "6c564dffad127a402ca6bbec87e57695d501b4f2b7b87427d6fd16e3e7ee84a9",
      "coverage": {
        "tables": [
          "purchasing_attachments"
        ],
        "functions": [],
        "indexes": [
          "purchasing_attachments_document_sha_key",
          "purchasing_attachments_document_created_idx"
        ],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "purchasing_attachments": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {}
      },
      "after": {
        "tables": {
          "purchasing_attachments": "aed6e83a70c8aa1394e7ca113451f333d0158f4cf847ce7b614b47d0fa5f8711"
        },
        "functions": {}
      }
    },
    {
      "name": "20261102120000_accounting_financial_approval_receipts",
      "sqlSha256": "d8ee324f20554891f7b276725326f07ac22658cf8180af0d70baf95f9e54f378",
      "coverage": {
        "tables": [
          "accounting_financial_approval_receipts"
        ],
        "functions": [],
        "indexes": [],
        "sourceMap": "BOUNDED_SQL_PATTERN_NOT_PARSER"
      },
      "before": {
        "tables": {
          "accounting_financial_approval_receipts": "bb67abd40793634acb380f7a86f8374faafa1facc7bc1b9c57bce4b2884e4e05"
        },
        "functions": {}
      },
      "after": {
        "tables": {
          "accounting_financial_approval_receipts": "85c4c8bba247e33046d4f5211178c919a459c8e36d0e8d50b50e5009c783463b"
        },
        "functions": {}
      }
    }
  ]
} as const;

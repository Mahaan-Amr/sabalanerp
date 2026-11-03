-- Restore relational ContractItem rows only for the narrow legacy shape where:
--   * the contract has no relational items at all;
--   * a graph-v1 state is backed by its exact immutable legacy-migration audit;
--   * contractData products and graph rows match one-for-one by ordinal/product.
-- The identifiers are deterministic and every conversion is recorded below.

WITH eligible AS (
  SELECT c.id AS contract_id, c."contractData"::jsonb AS contract_data, s.graph::jsonb AS graph
  FROM "sales_contracts" c
  JOIN "sales_contract_product_graph_states" s ON s."contractId" = c.id
  WHERE s."schemaVersion" = 1
    AND NOT EXISTS (SELECT 1 FROM "contract_items" i WHERE i."contractId" = c.id)
    AND EXISTS (
      SELECT 1 FROM "sales_contract_product_graph_audits" a
      WHERE a."contractId" = c.id
        AND a."resultRevision" = s.revision
        AND a."inputHash" = s."inputHash"
        AND a."resultHash" = s."resultHash"
        AND a.command->>'kind' = 'legacy-migration'
    )
    AND jsonb_typeof(c."contractData"::jsonb->'products') = 'array'
    AND jsonb_typeof(s.graph::jsonb->'rows') = 'array'
    AND jsonb_array_length(c."contractData"::jsonb->'products') > 0
    AND jsonb_array_length(c."contractData"::jsonb->'products') = jsonb_array_length(s.graph::jsonb->'rows')
), matched AS (
  SELECT e.contract_id, p.ordinality, p.value AS product, g.value AS graph_row
  FROM eligible e
  CROSS JOIN LATERAL jsonb_array_elements(e.contract_data->'products') WITH ORDINALITY p(value, ordinality)
  JOIN LATERAL jsonb_array_elements(e.graph->'rows') WITH ORDINALITY g(value, ordinality)
    ON g.ordinality = p.ordinality
  WHERE NULLIF(p.value->>'productId', '') = NULLIF(g.value->>'catalogProductId', '')
    AND NULLIF(g.value->>'productRowId', '') IS NOT NULL
    AND COALESCE(p.value->>'quantity', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$'
    AND COALESCE(p.value->>'totalPrice', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$'
    AND COALESCE(p.value->>'originalTotalPrice', p.value->>'totalPrice', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$'
), complete AS (
  SELECT m.*
  FROM matched m
  WHERE (SELECT count(*) FROM matched x WHERE x.contract_id = m.contract_id) =
        (SELECT jsonb_array_length(e.contract_data->'products') FROM eligible e WHERE e.contract_id = m.contract_id)
)
INSERT INTO "contract_items" (
  id, "contractId", "productId", "productRowId", "productType", quantity,
  "unitPrice", "totalPrice", description, "isMandatory", "mandatoryPercentage",
  "originalTotalPrice", "stairSystemId", "stairPartType", "createdAt", "updatedAt"
)
SELECT
  'legacy-item-' || md5(contract_id || ':' || ordinality::text),
  contract_id,
  product->>'productId',
  graph_row->>'productRowId',
  NULLIF(product->>'productType', ''),
  round((product->>'quantity')::numeric, 3),
  round(COALESCE(NULLIF(product->>'unitPrice', ''), NULLIF(product->>'pricePerSquareMeter', ''), '0')::numeric, 2),
  round((product->>'totalPrice')::numeric, 2),
  NULLIF(product->>'description', ''),
  COALESCE((product->>'isMandatory')::boolean, false),
  CASE WHEN COALESCE(product->>'mandatoryPercentage', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$'
    THEN round((product->>'mandatoryPercentage')::numeric, 2) ELSE NULL END,
  round(COALESCE(NULLIF(product->>'originalTotalPrice', ''), product->>'totalPrice')::numeric, 2),
  NULLIF(product->>'stairSystemId', ''),
  NULLIF(product->>'stairPartType', ''),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM complete;

INSERT INTO "accounting_audit_logs" (
  id, action, "actorId", "contractId", "entityType", "entityId", "beforeState", "afterState", note, "createdAt"
)
SELECT
  'legacy-item-audit-' || md5(c.id),
  'RECONSTRUCT_LEGACY_CONTRACT_ITEMS',
  'system:migration:20260819123000',
  c.id,
  'SalesContract',
  c.id,
  jsonb_build_object('contractItemCount', 0),
  jsonb_build_object(
    'contractItemCount', count(i.id),
    'assignments', jsonb_agg(jsonb_build_object(
      'contractItemId', i.id,
      'productRowId', i."productRowId",
      'rawQuantity', (p.value->>'quantity'),
      'sealedQuantity', i.quantity::text,
      'rawTotalPrice', (p.value->>'totalPrice'),
      'sealedTotalPrice', i."totalPrice"::text,
      'rule', 'LEGACY_GRAPH_V1_ORDINAL_PRODUCT_IDENTITY_AND_DECLARED_SCALE'
    ) ORDER BY p.ordinality)
  ),
  'بازسازی قطعی اقلام relational قرارداد از Product Graph نسخه ۱ و snapshot فریز‌شده؛ بدون حدس یا tolerance.',
  CURRENT_TIMESTAMP
FROM "sales_contracts" c
JOIN "contract_items" i ON i."contractId" = c.id AND i.id LIKE 'legacy-item-%'
CROSS JOIN LATERAL jsonb_array_elements(c."contractData"::jsonb->'products') WITH ORDINALITY p(value, ordinality)
WHERE i.id = 'legacy-item-' || md5(c.id || ':' || p.ordinality::text)
  AND NOT EXISTS (
    SELECT 1 FROM "accounting_audit_logs" a
    WHERE a.action = 'RECONSTRUCT_LEGACY_CONTRACT_ITEMS' AND a."contractId" = c.id
  )
GROUP BY c.id;

CREATE TABLE "sales_contract_product_graph_states" (
    "contractId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "totalAmountToman" DECIMAL(20,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_contract_product_graph_states_pkey" PRIMARY KEY ("contractId")
);

CREATE TABLE "sales_contract_product_graph_audits" (
    "commandId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "command" JSONB NOT NULL,
    "resultGraph" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_contract_product_graph_audits_pkey" PRIMARY KEY ("commandId")
);

CREATE UNIQUE INDEX "sales_contract_product_graph_audits_contractId_resultRevision_key"
ON "sales_contract_product_graph_audits"("contractId", "resultRevision");

CREATE INDEX "sales_contract_product_graph_audits_contractId_createdAt_idx"
ON "sales_contract_product_graph_audits"("contractId", "createdAt");

ALTER TABLE "sales_contract_product_graph_states"
ADD CONSTRAINT "sales_contract_product_graph_states_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_contract_product_graph_audits"
ADD CONSTRAINT "sales_contract_product_graph_audits_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

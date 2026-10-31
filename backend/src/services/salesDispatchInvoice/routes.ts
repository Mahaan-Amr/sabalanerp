import express, { type RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { createSalesInvoiceService } from "./service";
import { SalesInvoiceError } from "./source";
export function createSalesInvoiceRouter(input: {
  db: PrismaClient;
  workspace: "accounting" | "logistics";
  view: RequestHandler[];
  edit?: RequestHandler[];
}) {
  const router = express.Router(),
    service = createSalesInvoiceService(input.db);
  const handle =
    (work: (req: any, res: any) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      try {
        res.setHeader("Cache-Control", "private, no-store");
        await work(req, res);
      } catch (error) {
        if (error instanceof SalesInvoiceError)
          return void res
            .status(error.status)
            .json({ success: false, error: error.message });
        console.error("Sales dispatch invoice error:", error);
        res
          .status(500)
          .json({ success: false, error: "عملیات فاکتور فروش انجام نشد." });
      }
    };
  const context = (req: any) => ({
    actorId: req.user.id,
    workspace: input.workspace,
  });
  router.get(
    "/loadings/:loadingId/sales-invoices",
    input.view,
    handle(async (req, res) =>
      res.json({
        success: true,
        data: await service.list(context(req), req.params.loadingId),
      }),
    ),
  );
  router.get(
    "/loadings/:loadingId/sales-invoices/:invoiceId/pdf",
    input.view,
    handle(async (req, res) => {
      const result = await service.download(
        context(req),
        req.params.loadingId,
        req.params.invoiceId,
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${req.query.download === "true" ? "attachment" : "inline"}; filename="sales_invoice_${result.number}.pdf"`,
      );
      res.send(Buffer.from(result.bytes));
    }),
  );
  if (input.workspace === "accounting" && input.edit) {
    router.post(
      "/loadings/:loadingId/sales-invoices",
      input.edit,
      handle(async (req, res) =>
        res.json({
          success: true,
          data: await service.issue(
            context(req),
            req.params.loadingId,
            String(req.get("Idempotency-Key") || req.body.idempotencyKey || ""),
          ),
        }),
      ),
    );
    router.post(
      "/loadings/:loadingId/sales-invoices/:invoiceId/void",
      input.edit,
      handle(async (req, res) =>
        res.json({
          success: true,
          data: await service.void(
            context(req),
            req.params.loadingId,
            req.params.invoiceId,
            req.body.reason,
          ),
        }),
      ),
    );
  } else if (input.workspace === 'logistics') {
    router.post(['/loadings/:loadingId/sales-invoices', '/loadings/:loadingId/sales-invoices/:invoiceId/void'], input.view,
      handle(async () => { throw new SalesInvoiceError('صدور و ابطال فاکتور فروش فقط در حسابداری مجاز است.', 403); }));
  }
  return router;
}

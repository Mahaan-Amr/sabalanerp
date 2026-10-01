import type { NextFunction, Response } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';

/** A stale page or omitted URL flag must never create an internal Customer
 * for a Partner identity. Partner commands own authorization and ownership. */
export function ordinaryCustomerCreationGuard(database: Pick<PrismaClient | Prisma.TransactionClient, 'partnerProfile'>) {
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await database.partnerProfile.findUnique({
        where: { userId: req.user.id }, select: { id: true },
      });
      if (profile) {
        res.status(409).json({ success: false, code: 'PARTNER_CUSTOMER_ROUTE_REQUIRED',
          error: 'این حساب فروشنده همکار است؛ مشتری را از مسیر مشتریان همکار ثبت کنید.' });
        return;
      }
      next();
    } catch (error) { next(error); }
  };
}

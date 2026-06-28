import express, { Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { buildCatalogPlan, applyCatalogPlan, buildExportWorkbook, buildTemplateWorkbook, CatalogKey } from '../services/catalogExcelSync';

const router = express.Router();
const prisma = new PrismaClient();

const upload = multer({
  dest: 'uploads/',
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('Only Excel files are allowed'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

const allowedCatalogs: CatalogKey[] = [
  'services',
  'cutting-types',
  'sub-services',
  'stair-lengths',
  'layer-types',
  'stone-finishings'
];

const resolveCatalog = (value: string): CatalogKey | null => {
  return allowedCatalogs.includes(value as CatalogKey) ? value as CatalogKey : null;
};

const sendWorkbook = (res: Response, buffer: Buffer, filename: string) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
};

router.get(
  '/:catalog/template',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW),
  async (req: any, res: Response) => {
    const catalog = resolveCatalog(req.params.catalog);
    if (!catalog) return res.status(404).json({ success: false, error: 'Catalog not found' });
    const buffer = buildTemplateWorkbook(catalog);
    return sendWorkbook(res, buffer, `${catalog}-template.xlsx`);
  }
);

router.get(
  '/:catalog/export',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.VIEW),
  async (req: any, res: Response) => {
    try {
      const catalog = resolveCatalog(req.params.catalog);
      if (!catalog) return res.status(404).json({ success: false, error: 'Catalog not found' });
      const buffer = await buildExportWorkbook(prisma, catalog);
      return sendWorkbook(res, buffer, `${catalog}-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      console.error('Catalog export failed:', error);
      return res.status(500).json({ success: false, error: 'خطا در خروجی اکسل' });
    }
  }
);

router.post(
  '/:catalog/import/preview',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  upload.single('file'),
  async (req: any, res: Response) => {
    try {
      const catalog = resolveCatalog(req.params.catalog);
      if (!catalog) return res.status(404).json({ success: false, error: 'Catalog not found' });
      if (!req.file) return res.status(400).json({ success: false, error: 'فایل اکسل انتخاب نشده است' });
      const plan = await buildCatalogPlan(prisma, catalog, req.file.path);
      return res.json({ success: true, data: plan });
    } catch (error: any) {
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      console.error('Catalog preview failed:', error);
      return res.status(500).json({ success: false, error: error.message || 'خطا در بررسی فایل اکسل' });
    }
  }
);

router.post(
  '/:catalog/import/apply',
  protect,
  requireWorkspaceAccess(WORKSPACES.INVENTORY, WORKSPACE_PERMISSIONS.EDIT),
  async (req: any, res: Response) => {
    try {
      const catalog = resolveCatalog(req.params.catalog);
      if (!catalog) return res.status(404).json({ success: false, error: 'Catalog not found' });
      const plan = await applyCatalogPlan(prisma, String(req.body.importId || ''));
      return res.json({ success: true, data: plan });
    } catch (error: any) {
      console.error('Catalog apply failed:', error);
      return res.status(400).json({ success: false, error: error.message || 'خطا در اعمال فایل اکسل' });
    }
  }
);

export default router;

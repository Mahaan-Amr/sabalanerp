import express, { Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { protect } from '../middleware/auth';
import { requireAnyFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const uploadDir = path.join(process.cwd(), 'uploads', 'images');
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const ensureUploadDir = () => {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.has(ext) && allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPG, PNG, and WebP images are allowed'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

router.post(
  '/images',
  protect,
  requireAnyFeatureAccess(
    [
      FEATURES.SALES_CONTRACTS_CREATE,
      FEATURES.SALES_CONTRACTS_EDIT,
      FEATURES.SALES_PRODUCTS_EDIT,
      FEATURES.INVENTORY_SERVICES_EDIT,
      FEATURES.INVENTORY_CUTTING_TYPES_EDIT,
      FEATURES.INVENTORY_SUB_SERVICES_EDIT,
      FEATURES.INVENTORY_STONE_FINISHINGS_EDIT
    ],
    FEATURE_PERMISSIONS.EDIT
  ),
  upload.single('image'),
  (req: any, res: Response) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Image file is required'
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        url: `/files/uploads/images/${req.file.filename}`,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      }
    });
  }
);

export default router;

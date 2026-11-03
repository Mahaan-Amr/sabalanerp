import express, { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { getRequestEvidence } from '../utils/requestEvidence';

const router = express.Router();
const confirmationError = (result: { success: boolean; error?: string }) =>
  result.error || 'اطلاعات تأیید قرارداد در دسترس نیست';

router.post(
  '/contracts/confirm/lookup',
  [
    body('contractNumber').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Invalid contract number'),
    body('phoneNumber').isString().trim().isLength({ min: 8, max: 20 }).withMessage('Invalid phone number')
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'شماره قرارداد و شماره تماس معتبر نیست' });
    }

    const result = await contractConfirmationService.getPublicContractByManualLookup({
      contractNumber: String(req.body.contractNumber || ''),
      phoneNumber: String(req.body.phoneNumber || ''),
      meta: getRequestEvidence(req)
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: confirmationError(result) });
    }

    return res.json({ success: true, data: result.data });
  }
);

router.post(
  '/contracts/confirm/verify',
  [
    body('contractNumber').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Invalid contract number'),
    body('phoneNumber').isString().trim().isLength({ min: 8, max: 20 }).withMessage('Invalid phone number'),
    body('code').isString().isLength({ min: 4, max: 8 }).withMessage('Invalid verification code')
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'اطلاعات تایید معتبر نیست' });
    }

    const result = await contractConfirmationService.verifyPublicOtpByManualLookup({
      contractNumber: String(req.body.contractNumber || ''),
      phoneNumber: String(req.body.phoneNumber || ''),
      code: String(req.body.code || ''),
      meta: getRequestEvidence(req)
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: confirmationError(result) });
    }

    return res.json({
      success: true,
      message: 'قرارداد با موفقیت تایید شد',
      data: 'data' in result ? result.data : undefined
    });
  }
);

router.post(
  '/contracts/confirm/resend',
  [
    body('contractNumber').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Invalid contract number'),
    body('phoneNumber').isString().trim().isLength({ min: 8, max: 20 }).withMessage('Invalid phone number')
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'شماره قرارداد و شماره تماس معتبر نیست' });
    }

    const result = await contractConfirmationService.resendFromManualLookup({
      contractNumber: String(req.body.contractNumber || ''),
      phoneNumber: String(req.body.phoneNumber || ''),
      meta: getRequestEvidence(req)
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: confirmationError(result) });
    }

    return res.json({
      success: true,
      message: 'کد تایید دوباره ارسال شد',
      data: {
        otpExpiresAt: result.data?.otpExpiresAt,
        expiresAt: result.data?.expiresAt
      }
    });
  }
);

router.get(
  '/contracts/confirm/:token',
  [param('token').isLength({ min: 32 }).withMessage('Invalid token')],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Invalid confirmation link' });
    }

    const result = await contractConfirmationService.getPublicContractByToken(
      req.params.token,
      getRequestEvidence(req)
    );

    if (!result.success) {
      return res.status(400).json({ success: false, error: confirmationError(result) });
    }

    return res.json({ success: true, data: result.data });
  }
);

router.post(
  '/contracts/confirm/:token/verify',
  [
    param('token').isLength({ min: 32 }).withMessage('Invalid token'),
    body('code').isString().isLength({ min: 4, max: 8 }).withMessage('Invalid verification code')
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
    }

    const result = await contractConfirmationService.verifyPublicOtp({
      token: req.params.token,
      code: String(req.body.code || ''),
      meta: getRequestEvidence(req)
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: confirmationError(result) });
    }

    return res.json({
      success: true,
      message: 'Contract was confirmed successfully',
      data: result.data
    });
  }
);

router.post(
  '/contracts/confirm/:token/resend',
  [param('token').isLength({ min: 32 }).withMessage('Invalid token')],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Invalid confirmation link' });
    }

    const result = await contractConfirmationService.resendFromPublicToken({
      token: req.params.token,
      meta: getRequestEvidence(req)
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: confirmationError(result) });
    }

    return res.json({
      success: true,
      message: 'Verification code sent again',
      data: {
        otpExpiresAt: result.data?.otpExpiresAt,
        expiresAt: result.data?.expiresAt
      }
    });
  }
);

export default router;

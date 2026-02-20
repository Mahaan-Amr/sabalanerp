import express, { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { contractConfirmationService } from '../services/contractConfirmationService';
import { getRequestEvidence } from '../utils/requestEvidence';

const router = express.Router();

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
      return res.status(400).json({ success: false, error: result.error });
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
      return res.status(400).json({ success: false, error: result.error });
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
      return res.status(400).json({ success: false, error: result.error });
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

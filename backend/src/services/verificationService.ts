/**
 * Verification Service
 * Manages contract verification codes, validation, and cleanup
 */

import { PrismaClient } from '@prisma/client';
import smsService from './smsService';

const prisma = new PrismaClient();

interface CreateVerificationCodeParams {
  contractId: string | null;
  phoneNumber: string;
}

interface VerifyCodeParams {
  code: string;
  contractId: string;
  phoneNumber: string;
}

class VerificationService {
  private readonly maxAttempts = 5;
  private readonly expiryMinutes: number;

  constructor() {
    this.expiryMinutes = parseInt(process.env.VERIFICATION_CODE_EXPIRY_MINUTES || '10', 10);
  }

  /**
   * Create a new verification code and send SMS
   * @param params - Contract ID and phone number
   * @returns Created verification code record
   */
  async createVerificationCode(
    params: CreateVerificationCodeParams
  ): Promise<{ success: boolean; verificationCode?: any; error?: string }> {
    try {
      const { contractId, phoneNumber } = params;

      // Check rate limiting: max 3 SMS per phone per hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCodes = await prisma.contractVerificationCode.count({
        where: {
          phoneNumber,
          createdAt: {
            gte: oneHourAgo
          }
        }
      });

      if (recentCodes >= 3) {
        return {
          success: false,
          error: 'تعداد درخواست‌های ارسال کد برای این شماره بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید.'
        };
      }

      // Invalidate previous codes for this contract+phone
      if (contractId) {
        await prisma.contractVerificationCode.updateMany({
          where: {
            contractId,
            phoneNumber,
            verified: false,
            expiresAt: {
              gt: new Date()
            }
          },
          data: {
            verified: true // Mark as used (invalidated)
          }
        });
      }

      // Generate verification code
      const code = smsService.generateVerificationCode();

      // Calculate expiry time
      const expiresAt = new Date(Date.now() + this.expiryMinutes * 60 * 1000);

      // Create verification code record
      const verificationCode = await prisma.contractVerificationCode.create({
        data: {
          contractId,
          phoneNumber,
          code,
          expiresAt,
          verified: false,
          attempts: 0
        }
      });

      // Send SMS
      const smsResult = await smsService.sendVerificationCode(phoneNumber, code);

      // Log verification code in development/sandbox mode
      const environment = process.env.SMS_IR_ENVIRONMENT || 'sandbox';
      if (environment === 'sandbox') {
        console.log('='.repeat(60));
        console.log('? VERIFICATION CODE (SANDBOX MODE)');
        console.log('='.repeat(60));
        console.log(`Contract ID: ${contractId || 'N/A'}`);
        console.log(`Phone Number: ${phoneNumber}`);
        console.log(`Verification Code: ${code}`);
        console.log(`Expires At: ${expiresAt.toISOString()}`);
        console.log('='.repeat(60));
      }

      if (!smsResult.success) {
        // Delete the code if SMS failed
        await prisma.contractVerificationCode.delete({
          where: { id: verificationCode.id }
        });

        return {
          success: false,
          error: smsResult.error || 'خطا در ارسال پیامک'
        };
      }

      return {
        success: true,
        verificationCode: {
          ...verificationCode,
          // Include code in response only for sandbox mode
          code: environment === 'sandbox' ? code : undefined
        }
      };
    } catch (error: any) {
      console.error('Create verification code error:', error);
      return {
        success: false,
        error: error.message || 'خطا در ایجاد کد تایید'
      };
    }
  }

  /**
   * Verify a code
   * @param params - Code, contract ID, and phone number
   * @returns Verification result
   */
  async verifyCode(params: VerifyCodeParams): Promise<{ success: boolean; error?: string }> {
    try {
      const { code, contractId, phoneNumber } = params;

      // Find the verification code
      const verificationCode = await prisma.contractVerificationCode.findFirst({
        where: {
          contractId,
          phoneNumber,
          verified: false
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (!verificationCode) {
        return {
          success: false,
          error: 'کد تایید یافت نشد'
        };
      }

      // Check if expired
      if (new Date() > verificationCode.expiresAt) {
        return {
          success: false,
          error: 'کد تایید منقضی شده است'
        };
      }

      // Check max attempts
      if (verificationCode.attempts >= this.maxAttempts) {
        return {
          success: false,
          error: 'تعداد دفعات وارد کردن کد بیش از حد مجاز است'
        };
      }

      // Increment attempts
      await prisma.contractVerificationCode.update({
        where: { id: verificationCode.id },
        data: {
          attempts: verificationCode.attempts + 1
        }
      });

      // Verify code
      if (verificationCode.code !== code) {
        return {
          success: false,
          error: 'کد تایید نامعتبر است'
        };
      }

      // Mark as verified
      await prisma.contractVerificationCode.update({
        where: { id: verificationCode.id },
        data: {
          verified: true,
          verifiedAt: new Date()
        }
      });

      // Update contract if it exists
      if (contractId) {
        await prisma.salesContract.update({
          where: { id: contractId },
          data: {
            isSigned: true,
            signedAt: new Date(),
            signedByPhoneNumber: phoneNumber,
            verificationCodeId: verificationCode.id,
            status: 'SIGNED'
          }
        });
      }

      return {
        success: true
      };
    } catch (error: any) {
      console.error('Verify code error:', error);
      return {
        success: false,
        error: error.message || 'خطا در تایید کد'
      };
    }
  }

  /**
   * Cleanup expired codes (should be run as scheduled job)
   * @returns Number of deleted codes
   */
  async cleanupExpiredCodes(): Promise<number> {
    try {
      const result = await prisma.contractVerificationCode.deleteMany({
        where: {
          expiresAt: {
            lt: new Date()
          },
          verified: false
        }
      });

      return result.count;
    } catch (error: any) {
      console.error('Cleanup expired codes error:', error);
      return 0;
    }
  }

  /**
   * Get remaining time for a verification code
   * @param contractId - Contract ID
   * @param phoneNumber - Phone number
   * @returns Remaining seconds or null if not found/expired
   */
  async getRemainingTime(contractId: string, phoneNumber: string): Promise<number | null> {
    try {
      const verificationCode = await prisma.contractVerificationCode.findFirst({
        where: {
          contractId,
          phoneNumber,
          verified: false
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (!verificationCode) {
        return null;
      }

      const now = new Date();
      const expiresAt = verificationCode.expiresAt;

      if (now > expiresAt) {
        return 0; // Expired
      }

      const remainingMs = expiresAt.getTime() - now.getTime();
      return Math.floor(remainingMs / 1000); // Return seconds
    } catch (error) {
      console.error('Get remaining time error:', error);
      return null;
    }
  }
}

// Export singleton instance
export const verificationService = new VerificationService();
export default verificationService;



import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import smsService from './smsService';

const prisma = new PrismaClient();

const LINK_TTL_DAYS = parseInt(process.env.CONTRACT_CONFIRM_LINK_TTL_DAYS || '60', 10);
const OTP_TTL_MINUTES = parseInt(process.env.CONTRACT_CONFIRM_OTP_TTL_MINUTES || '10', 10);
const MAX_ATTEMPTS = parseInt(process.env.CONTRACT_CONFIRM_MAX_ATTEMPTS || '5', 10);
const RESEND_COOLDOWN_SECONDS = parseInt(process.env.CONTRACT_CONFIRM_RESEND_COOLDOWN_SECONDS || '60', 10);

export interface RequestEvidenceMeta {
  ipAddress?: string;
  userAgent?: string;
  acceptLanguage?: string;
  deviceFingerprint?: string;
  referrer?: string;
}

export interface SendConfirmationResult {
  success: boolean;
  error?: string;
  data?: {
    contractId: string;
    status: string;
    phoneNumber: string;
    publicLink?: string;
    expiresAt: string;
    otpExpiresAt: string;
    messageId?: string;
  };
}

const hashValue = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const generatePublicToken = () => crypto.randomBytes(32).toString('hex');

const nowPlusDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
const nowPlusMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000);

function extractCustomerPhone(customer: any): string | null {
  const candidates = [
    customer?.homeNumber,
    customer?.workNumber,
    customer?.projectManagerNumber,
    customer?.phoneNumbers?.find((p: any) => p?.isPrimary)?.number,
    customer?.phoneNumbers?.[0]?.number,
    customer?.primaryContact?.mobile,
    customer?.primaryContact?.phone
  ]
    .map((v: unknown) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);

  return candidates[0] || null;
}

function extractCustomerName(customer: any): string {
  const fullName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName;
  }
  return customer?.companyName || '?????';
}

async function createAuditLog(params: {
  contractId: string;
  sessionId?: string | null;
  eventType: string;
  eventPayloadJson?: any;
  provider?: string;
  providerMessageId?: string;
  providerRawResponse?: any;
  meta?: RequestEvidenceMeta;
}) {
  const payloadHash = hashValue(
    JSON.stringify({
      contractId: params.contractId,
      sessionId: params.sessionId || null,
      eventType: params.eventType,
      eventPayloadJson: params.eventPayloadJson || null,
      provider: params.provider || null,
      providerMessageId: params.providerMessageId || null,
      at: new Date().toISOString()
    })
  );

  await prisma.contractConfirmationAuditLog.create({
    data: {
      contractId: params.contractId,
      sessionId: params.sessionId || null,
      eventType: params.eventType,
      eventPayloadJson: params.eventPayloadJson || null,
      provider: params.provider || null,
      providerMessageId: params.providerMessageId || null,
      providerRawResponse: params.providerRawResponse || null,
      ipAddress: params.meta?.ipAddress || null,
      userAgent: params.meta?.userAgent || null,
      acceptLanguage: params.meta?.acceptLanguage || null,
      deviceFingerprint: params.meta?.deviceFingerprint || null,
      referrer: params.meta?.referrer || null,
      eventHash: payloadHash
    }
  });
}

export class ContractConfirmationService {
  async sendForConfirmation(params: {
    contractId: string;
    requestedBy: string;
    resend?: boolean;
    explicitToken?: string;
    meta?: RequestEvidenceMeta;
  }): Promise<SendConfirmationResult> {
    const contract = await prisma.salesContract.findUnique({
      where: { id: params.contractId },
      include: {
        customer: {
          include: {
            phoneNumbers: true,
            primaryContact: true
          }
        }
      }
    });

    if (!contract) {
      return { success: false, error: '??????? ???? ???' };
    }

    if (contract.status === 'CANCELLED') {
      return { success: false, error: '??????? ??? ??? ???' };
    }

    const phoneNumber = extractCustomerPhone(contract.customer);
    if (!phoneNumber) {
      return { success: false, error: '????? ???? ????? ?? CRM ????? ????' };
    }

    const existingActiveSession = await prisma.contractPublicConfirmation.findFirst({
      where: {
        contractId: params.contractId,
        status: 'PENDING',
        linkExpiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    const otpCode = generateOtp();
    const otpCodeHash = hashValue(otpCode);
    const otpExpiresAt = nowPlusMinutes(OTP_TTL_MINUTES);

    let rawToken: string | null = null;
    let session = existingActiveSession;

    if (session && params.resend) {
      if (session.lastSentAt) {
        const secondsSinceLastSend = Math.floor((Date.now() - session.lastSentAt.getTime()) / 1000);
        if (secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
          return {
            success: false,
            error: `????? ???? ?? ${RESEND_COOLDOWN_SECONDS - secondsSinceLastSend} ????? ???? ???? ????`
          };
        }
      }

      session = await prisma.contractPublicConfirmation.update({
        where: { id: session.id },
        data: {
          otpCodeHash,
          otpExpiresAt,
          attemptsUsed: 0,
          resendCount: session.resendCount + 1,
          lastSentAt: new Date()
        }
      });
      rawToken = params.explicitToken || null;
    } else {
      await prisma.contractPublicConfirmation.updateMany({
        where: {
          contractId: params.contractId,
          status: 'PENDING'
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });

      rawToken = generatePublicToken();
      session = await prisma.contractPublicConfirmation.create({
        data: {
          contractId: params.contractId,
          tokenHash: hashValue(rawToken),
          phoneNumber,
          otpCodeHash,
          otpExpiresAt,
          linkExpiresAt: nowPlusDays(LINK_TTL_DAYS),
          status: 'PENDING',
          maxAttempts: MAX_ATTEMPTS,
          attemptsUsed: 0,
          lastSentAt: new Date(),
          resendCount: params.resend ? 1 : 0,
          createdBy: params.requestedBy
        }
      });
    }

    if (!session) {
      return { success: false, error: '????? ???? ????? ??????? ?????? ???' };
    }

    if (!rawToken) {
      rawToken = generatePublicToken();
      await prisma.contractPublicConfirmation.update({
        where: { id: session.id },
        data: { tokenHash: hashValue(rawToken) }
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const publicLink = `${frontendUrl}/contracts/confirm/${rawToken}`;

    const smsResult = await smsService.sendContractConfirmationMessage({
      phoneNumber,
      code: otpCode,
      customerName: extractCustomerName(contract.customer),
      contractNumber: contract.contractNumber,
      confirmationLink: publicLink
    });

    await createAuditLog({
      contractId: contract.id,
      sessionId: session.id,
      eventType: 'LINK_CREATED',
      eventPayloadJson: {
        linkExpiresAt: session.linkExpiresAt.toISOString(),
        otpExpiresAt: session.otpExpiresAt.toISOString(),
        resend: !!params.resend
      },
      meta: params.meta
    });

    await createAuditLog({
      contractId: contract.id,
      sessionId: session.id,
      eventType: 'SMS_SENT',
      eventPayloadJson: {
        resend: !!params.resend,
        smsSuccess: smsResult.success
      },
      provider: 'sms.ir',
      providerMessageId: smsResult.messageId ? String(smsResult.messageId) : undefined,
      providerRawResponse: smsResult.rawResponse,
      meta: params.meta
    });

    if (!smsResult.success) {
      return {
        success: false,
        error: smsResult.error || '????? ????? ?????? ???'
      };
    }

    if (contract.status === 'DRAFT') {
      await prisma.salesContract.update({
        where: { id: contract.id },
        data: {
          status: 'PENDING_APPROVAL',
          signatures: {
            ...((contract.signatures as Record<string, unknown>) || {}),
            digitalConfirmation: {
              status: 'PENDING',
              sentAt: new Date().toISOString(),
              phoneNumber,
              sessionId: session.id
            }
          }
        }
      });
    }

    return {
      success: true,
      data: {
        contractId: contract.id,
        status: 'PENDING_APPROVAL',
        phoneNumber,
        publicLink,
        expiresAt: session.linkExpiresAt.toISOString(),
        otpExpiresAt: session.otpExpiresAt.toISOString(),
        messageId: smsResult.messageId ? String(smsResult.messageId) : undefined
      }
    };
  }

  async getConfirmationStatus(contractId: string) {
    const contract = await prisma.salesContract.findUnique({
      where: { id: contractId },
      include: {
        publicConfirmations: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!contract) {
      return { success: false, error: '??????? ???? ???' };
    }

    const session = contract.publicConfirmations[0] || null;

    const lastOpen = await prisma.contractConfirmationAuditLog.findFirst({
      where: {
        contractId,
        sessionId: session?.id || undefined,
        eventType: 'LINK_OPENED'
      },
      orderBy: { eventAt: 'desc' }
    });

    return {
      success: true,
      data: {
        contractId,
        contractStatus: contract.status,
        sessionStatus: session?.status || null,
        phoneNumber: session?.phoneNumber || null,
        linkExpiresAt: session?.linkExpiresAt || null,
        otpExpiresAt: session?.otpExpiresAt || null,
        attemptsUsed: session?.attemptsUsed || 0,
        maxAttempts: session?.maxAttempts || MAX_ATTEMPTS,
        resendCount: session?.resendCount || 0,
        lastSentAt: session?.lastSentAt || null,
        lastOpenedAt: lastOpen?.eventAt || null,
        verifiedAt: session?.verifiedAt || null,
        isApproved: contract.status === 'APPROVED'
      }
    };
  }

  async getPublicContractByToken(token: string, meta?: RequestEvidenceMeta) {
    const tokenHash = hashValue(token);
    const session = await prisma.contractPublicConfirmation.findUnique({
      where: { tokenHash },
      include: {
        contract: {
          include: {
            customer: {
              include: {
                phoneNumbers: true,
                primaryContact: true
              }
            },
            items: {
              include: {
                product: true
              }
            },
            deliveries: true,
            payments: {
              include: {
                installments: true
              }
            },
            department: true
          }
        }
      }
    });

    if (!session) {
      return { success: false, error: '???? ????? ????? ????' };
    }

    if (session.status === 'CANCELLED') {
      return { success: false, error: '???? ????? ??? ??? ???' };
    }

    if (session.linkExpiresAt < new Date()) {
      await prisma.contractPublicConfirmation.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' }
      });
      return { success: false, error: '???? ???? ????? ?? ????? ????? ???' };
    }

    await createAuditLog({
      contractId: session.contractId,
      sessionId: session.id,
      eventType: 'LINK_OPENED',
      eventPayloadJson: {
        linkExpiresAt: session.linkExpiresAt.toISOString()
      },
      meta
    });

    const contract = session.contract;

    return {
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
        contractStatus: contract.status,
        otpExpiresAt: session.otpExpiresAt,
        linkExpiresAt: session.linkExpiresAt,
        contract: {
          id: contract.id,
          contractNumber: contract.contractNumber,
          title: contract.title,
          titlePersian: contract.titlePersian,
          contractData: contract.contractData,
          totalAmount: contract.totalAmount,
          currency: contract.currency,
          createdAt: contract.createdAt,
          customer: {
            firstName: contract.customer.firstName,
            lastName: contract.customer.lastName,
            companyName: contract.customer.companyName,
            phoneNumber: extractCustomerPhone(contract.customer)
          },
          items: contract.items,
          deliveries: contract.deliveries,
          payments: contract.payments
        }
      }
    };
  }

  async verifyPublicOtp(params: {
    token: string;
    code: string;
    meta?: RequestEvidenceMeta;
  }) {
    const tokenHash = hashValue(params.token);
    const session = await prisma.contractPublicConfirmation.findUnique({
      where: { tokenHash },
      include: { contract: true }
    });

    if (!session) {
      return { success: false, error: '???? ????? ????? ????' };
    }

    if (session.status !== 'PENDING') {
      return { success: false, error: '??? ???? ???? ???? ??????? ????' };
    }

    if (session.linkExpiresAt < new Date()) {
      await prisma.contractPublicConfirmation.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' }
      });
      return { success: false, error: '???? ???? ????? ?? ????? ????? ???' };
    }

    await createAuditLog({
      contractId: session.contractId,
      sessionId: session.id,
      eventType: 'OTP_SUBMITTED',
      eventPayloadJson: {
        codeLength: params.code.length
      },
      meta: params.meta
    });

    if (session.otpExpiresAt < new Date()) {
      return { success: false, error: '?? ????? ????? ??? ???' };
    }

    if (session.attemptsUsed >= session.maxAttempts) {
      return { success: false, error: '????? ???? ???? ?? ????? ????? ???' };
    }

    const nextAttempts = session.attemptsUsed + 1;
    const codeHash = hashValue(params.code.trim());

    if (codeHash !== session.otpCodeHash) {
      await prisma.contractPublicConfirmation.update({
        where: { id: session.id },
        data: {
          attemptsUsed: nextAttempts,
          status: nextAttempts >= session.maxAttempts ? 'EXPIRED' : 'PENDING'
        }
      });

      await createAuditLog({
        contractId: session.contractId,
        sessionId: session.id,
        eventType: 'OTP_FAILED',
        eventPayloadJson: {
          attemptsUsed: nextAttempts
        },
        meta: params.meta
      });

      return { success: false, error: '?? ????? ???? ????' };
    }

    const verifiedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.contractPublicConfirmation.update({
        where: { id: session.id },
        data: {
          attemptsUsed: nextAttempts,
          status: 'VERIFIED',
          verifiedAt
        }
      });

      await tx.salesContract.update({
        where: { id: session.contractId },
        data: {
          status: 'APPROVED',
          approvedBy: null,
          signatures: {
            ...((session.contract.signatures as Record<string, unknown>) || {}),
            digitalConfirmation: {
              status: 'VERIFIED',
              verifiedAt: verifiedAt.toISOString(),
              sessionId: session.id,
              phoneNumber: session.phoneNumber
            }
          }
        }
      });

      await tx.contractConfirmationAuditLog.create({
        data: {
          contractId: session.contractId,
          sessionId: session.id,
          eventType: 'OTP_VERIFIED',
          ipAddress: params.meta?.ipAddress || null,
          userAgent: params.meta?.userAgent || null,
          acceptLanguage: params.meta?.acceptLanguage || null,
          deviceFingerprint: params.meta?.deviceFingerprint || null,
          referrer: params.meta?.referrer || null,
          eventPayloadJson: {
            attemptsUsed: nextAttempts
          },
          eventHash: hashValue(`${session.contractId}:OTP_VERIFIED:${verifiedAt.toISOString()}`)
        }
      });
    });

    return {
      success: true,
      data: {
        contractId: session.contractId,
        status: 'APPROVED',
        verifiedAt: verifiedAt.toISOString()
      }
    };
  }

  async resendFromPublicToken(params: { token: string; meta?: RequestEvidenceMeta }) {
    const tokenHash = hashValue(params.token);
    const session = await prisma.contractPublicConfirmation.findUnique({
      where: { tokenHash },
      select: {
        contractId: true,
        status: true,
        linkExpiresAt: true
      }
    });

    if (!session) {
      return { success: false, error: 'Ù„ÛŒÙ†Ú© ØªØ§ÛŒÛŒØ¯ Ù…Ø¹ØªØ¨Ø± Ù†ÛŒØ³Øª' };
    }

    if (session.status !== 'PENDING') {
      return { success: false, error: 'Ø§ÛŒÙ† Ù„ÛŒÙ†Ú© Ø¯ÛŒÚ¯Ø± Ù‚Ø§Ø¨Ù„ Ø§Ø³ØªÙØ§Ø¯Ù‡ Ù†ÛŒØ³Øª' };
    }

    if (session.linkExpiresAt < new Date()) {
      return { success: false, error: 'Ù…Ù‡Ù„Øª Ù„ÛŒÙ†Ú© ØªØ§ÛŒÛŒØ¯ Ø¨Ù‡ Ù¾Ø§ÛŒØ§Ù† Ø±Ø³ÛŒØ¯Ù‡ Ø§Ø³Øª' };
    }

    return this.sendForConfirmation({
      contractId: session.contractId,
      requestedBy: 'public-resend',
      resend: true,
      explicitToken: params.token,
      meta: params.meta
    });
  }

  async cancelContract(params: {
    contractId: string;
    requestedBy: string;
    canCancelApproved: boolean;
    meta?: RequestEvidenceMeta;
  }) {
    const contract = await prisma.salesContract.findUnique({
      where: { id: params.contractId }
    });

    if (!contract) {
      return { success: false, error: '??????? ???? ???' };
    }

    if (contract.status === 'APPROVED' && !params.canCancelApproved) {
      return {
        success: false,
        error: '???? ??? ??????? ????? ??? ???? ???? ?? ??????'
      };
    }

    if (contract.status === 'CANCELLED') {
      return { success: true, data: { contractId: contract.id, status: contract.status } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.salesContract.update({
        where: { id: contract.id },
        data: {
          status: 'CANCELLED',
          signatures: {
            ...((contract.signatures as Record<string, unknown>) || {}),
            cancellation: {
              by: params.requestedBy,
              at: new Date().toISOString(),
              previousStatus: contract.status
            }
          }
        }
      });

      await tx.contractPublicConfirmation.updateMany({
        where: {
          contractId: contract.id,
          status: 'PENDING'
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });
    });

    await createAuditLog({
      contractId: contract.id,
      eventType: 'CONTRACT_CANCELLED',
      eventPayloadJson: {
        cancelledBy: params.requestedBy,
        previousStatus: contract.status
      },
      meta: params.meta
    });

    return {
      success: true,
      data: {
        contractId: contract.id,
        status: 'CANCELLED'
      }
    };
  }
}

export const contractConfirmationService = new ContractConfirmationService();


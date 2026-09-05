/**
 * SMS Service for sms.ir API Integration
 * Handles sending verification codes via sms.ir RESTful API
 */

import axios from 'axios';
import dns from 'dns';
import http from 'http';
import https from 'https';

interface SendVerificationCodeResponse {
  status: number;
  message: string;
  data?: {
    messageId: number;
    cost?: number;
  };
}

export interface SmsTemplateParameter {
  name: string;
  value: string;
}

const assertSixDigitHiringCode = (code: string, label: string) => {
  if (!/^\d{6}$/.test(code)) throw new Error(`${label} must contain exactly six digits.`);
};

export const buildHiringInvitationTemplateParameters = (code: string): SmsTemplateParameter[] => {
  assertSixDigitHiringCode(code, 'Hiring invitation access code');
  return [{ name: 'CODE', value: code }];
};

export const buildHiringCorrectionTemplateParameters = (
  details: string,
  code: string,
): SmsTemplateParameter[] => {
  const normalizedDetails = String(details || '').trim();
  if (!normalizedDetails) throw new Error('Hiring correction details are required.');
  assertSixDigitHiringCode(code, 'Hiring correction access code');
  return [
    { name: 'DETAILS', value: normalizedDetails },
    { name: 'CODE', value: code },
  ];
};

type SmsSendResult = {
  success: boolean;
  messageId?: number;
  error?: string;
  rawResponse?: unknown;
  failureKind?: 'PROVIDER_REJECTION' | 'HTTP' | 'NETWORK';
  httpStatus?: number;
  errorCode?: string;
};

export const buildHiringOfferTemplateParameters = (code: string): SmsTemplateParameter[] => {
  assertSixDigitHiringCode(code, 'Hiring offer access code');
  return [{ name: 'CODE', value: code }];
};

export const buildDispatchConfirmationOtpTemplateParameters = (
  dispatchNumber: string,
  code: string
): SmsTemplateParameter[] => {
  const normalizedDispatchNumber = String(dispatchNumber || '').trim();
  if (!normalizedDispatchNumber) throw new Error('Dispatch number is required for driver OTP delivery.');
  if (!/^\d{6}$/.test(code)) throw new Error('Dispatch confirmation code must contain exactly six digits.');
  return [
    { name: 'DISPATCHNUMBER', value: normalizedDispatchNumber },
    { name: 'CODE', value: code },
  ];
};

export const buildDispatchExitTemplateParameters = (
  dispatchNumber: string,
  vehiclePlate: string
): SmsTemplateParameter[] => {
  const normalizedDispatchNumber = String(dispatchNumber || '').trim();
  const normalizedVehiclePlate = String(vehiclePlate || '').trim();
  if (!normalizedDispatchNumber) throw new Error('Dispatch number is required for exit notification.');
  if (!normalizedVehiclePlate) throw new Error('Vehicle plate is required for exit notification.');
  return [
    { name: 'DNO', value: normalizedDispatchNumber },
    { name: 'PLATE', value: normalizedVehiclePlate },
  ];
};

function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length <= 4) {
    return '****';
  }

  return `${phoneNumber.slice(0, 4)}***${phoneNumber.slice(-2)}`;
}

class SmsService {
  private apiKey: string;
  private apiUrl: string;
  private templateId: number;
  private contractConfirmationTemplateId: number;
  private hiringInvitationTemplateId: number;
  private hiringCorrectionTemplateId: number;
  private hiringOfferTemplateId: number;
  private dispatchConfirmationOtpTemplateId: number;
  private dispatchExitTemplateId: number;
  private dispatchExitManualRetryTemplateId: number;
  private environment: string;
  private requestTimeoutMs: number;
  private dnsServers: string[];
  private httpAgent?: http.Agent;
  private httpsAgent?: https.Agent;

  constructor() {
    this.apiKey = process.env.SMS_IR_API_KEY || '';
    this.apiUrl = process.env.SMS_IR_API_URL || 'https://api.sms.ir/v1';
    this.templateId = parseInt(process.env.SMS_IR_TEMPLATE_ID || '135816', 10);
    this.contractConfirmationTemplateId = parseInt(
      process.env.SMS_IR_CONTRACT_CONFIRM_TEMPLATE_ID || '385075',
      10
    );
    this.hiringInvitationTemplateId = parseInt(
      process.env.SMS_IR_HIRING_INVITATION_TEMPLATE_ID || '343360',
      10
    );
    this.hiringCorrectionTemplateId = parseInt(
      process.env.SMS_IR_HIRING_CORRECTION_TEMPLATE_ID || '763918',
      10
    );
    this.hiringOfferTemplateId = parseInt(
      process.env.SMS_IR_HIRING_OFFER_TEMPLATE_ID || '894291',
      10
    );
    this.dispatchConfirmationOtpTemplateId = parseInt(
      process.env.SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID || '173656',
      10
    );
    this.dispatchExitTemplateId = parseInt(
      process.env.SMS_IR_DISPATCH_EXIT_TEMPLATE_ID || '153829',
      10
    );
    this.dispatchExitManualRetryTemplateId = parseInt(
      process.env.SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID || '3429496',
      10
    );
    this.environment = process.env.SMS_IR_ENVIRONMENT || 'sandbox';
    this.requestTimeoutMs = parseInt(process.env.SMS_IR_TIMEOUT_MS || '30000', 10);
    this.dnsServers = (process.env.SMS_IR_DNS_SERVERS || '')
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);

    if (this.dnsServers.length > 0) {
      const lookup = this.createCustomDnsLookup();
      this.httpAgent = new http.Agent({ lookup });
      this.httpsAgent = new https.Agent({ lookup });
      console.info('[sms.ir] using custom DNS resolvers', {
        dnsServers: this.dnsServers
      });
    }

    if (!this.apiKey) {
      console.warn('SMS_IR_API_KEY is not set in environment variables');
    }
  }

  private createCustomDnsLookup() {
    const resolver = new dns.Resolver();
    resolver.setServers(this.dnsServers);

    return (
      hostname: string,
      options: dns.LookupOneOptions | dns.LookupAllOptions | ((error: NodeJS.ErrnoException | null, address: string, family: number) => void),
      callback?: (
        error: NodeJS.ErrnoException | null,
        address: string | dns.LookupAddress[],
        family?: number
      ) => void
    ) => {
      const cb =
        typeof options === 'function'
          ? options
          : callback;
      const lookupOptions = typeof options === 'function' ? {} : options;

      if (!cb) {
        return;
      }

      const done = (error: NodeJS.ErrnoException | null, address?: string, family?: number) => {
        if (error) {
          cb(error, '', 4);
          return;
        }

        if (!address || !family) {
          const lookupError = new Error(`No DNS address resolved for ${hostname}`) as NodeJS.ErrnoException;
          lookupError.code = 'ENOTFOUND';
          cb(lookupError, '', 4);
          return;
        }

        if ('all' in lookupOptions && lookupOptions.all) {
          (
            cb as unknown as (
              error: NodeJS.ErrnoException | null,
              addresses: dns.LookupAddress[]
            ) => void
          )(null, [{ address, family }]);
          return;
        }

        cb(null, address, family);
      };

      resolver.resolve4(hostname, (ipv4Error, ipv4Addresses) => {
        if (!ipv4Error && ipv4Addresses.length > 0) {
          done(null, ipv4Addresses[0], 4);
          return;
        }

        resolver.resolve6(hostname, (ipv6Error, ipv6Addresses) => {
          if (!ipv6Error && ipv6Addresses.length > 0) {
            done(null, ipv6Addresses[0], 6);
            return;
          }

          done((ipv4Error || ipv6Error) as NodeJS.ErrnoException);
        });
      });
    };
  }

  /**
   * Generate a 6-digit random verification code
   * @returns 6-digit code (100000-999999)
   */
  generateVerificationCode(): string {
    const min = 100000;
    const max = 999999;
    const code = Math.floor(Math.random() * (max - min + 1)) + min;
    return code.toString();
  }

  /**
   * Format phone number for sms.ir API
   * Removes spaces and ensures format is 09xxxxxxxxx
   * @param phoneNumber - Phone number to format
   * @returns Formatted phone number
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove all spaces and non-digit characters except leading +
    let formatted = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    
    // Remove leading + if present
    if (formatted.startsWith('+')) {
      formatted = formatted.substring(1);
    }
    
    // Remove leading 0 if present (Iranian numbers)
    if (formatted.startsWith('0')) {
      formatted = formatted.substring(1);
    }
    
    // Add country code if not present (Iran: 98)
    if (!formatted.startsWith('98')) {
      formatted = '98' + formatted;
    }
    
    // Remove leading 98 and add 0 for Iranian format
    if (formatted.startsWith('98') && formatted.length === 12) {
      formatted = '0' + formatted.substring(2);
    }
    
    // Ensure it starts with 09
    if (!formatted.startsWith('09')) {
      // If it's 9xxxxxxxxx, add 0
      if (formatted.startsWith('9') && formatted.length === 10) {
        formatted = '0' + formatted;
      } else {
        throw new Error('Invalid phone number format');
      }
    }
    
    return formatted;
  }

  /**
   * Send verification code via sms.ir API
   * @param phoneNumber - Recipient phone number
   * @param code - 6-digit verification code
   * @returns Promise with success status and messageId
   */
  async sendVerificationCode(
    phoneNumber: string,
    code: string
  ): Promise<SmsSendResult> {
    try {
      // Validate API key
      if (!this.apiKey) {
        throw new Error('SMS API key is not configured');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // Prepare request
      return this.sendTemplate(formattedPhone, this.templateId, [
        {
          name: 'Code',
          value: code
        }
      ]);
    } catch (error: any) {
      console.error('SMS sending error:', error);
      
      // Handle axios errors
      if (error.response) {
        // API returned error response
        const errorMessage = error.response.data?.message || error.response.data?.error || 'SMS API error';
        return {
          success: false,
          error: errorMessage,
          rawResponse: error.response?.data
        };
      } else if (error.request) {
        // Request was made but no response received
        return {
          success: false,
          error: 'No response from SMS service'
        };
      } else {
        // Error in request setup
        return {
          success: false,
          error: error.message || 'Failed to send SMS'
        };
      }
    }
  }

  async sendContractConfirmationMessage(params: {
    phoneNumber: string;
    code: string;
    customerName: string;
    contractNumber: string;
  }): Promise<{ success: boolean; messageId?: number; error?: string; rawResponse?: unknown }> {
    if (this.environment === 'sandbox' && !this.apiKey) return { success: true };
    const formattedPhone = this.formatPhoneNumber(params.phoneNumber);
    return this.sendTemplate(formattedPhone, this.contractConfirmationTemplateId, [
      { name: 'Name', value: params.customerName },
      { name: 'ContractNumber', value: params.contractNumber },
      { name: 'Code', value: params.code }
    ]);
  }

  async sendHiringInvitation(params: {
    phoneNumber: string;
    code: string;
  }): Promise<{ success: boolean; messageId?: number; error?: string; rawResponse?: unknown }> {
    if (this.environment === 'sandbox' && !this.apiKey) {
      console.info('[sms.ir] sandbox hiring invitation', {
        mobile: maskPhoneNumber(params.phoneNumber)
      });
      return { success: true };
    }
    const formattedPhone = this.formatPhoneNumber(params.phoneNumber);
    return this.sendTemplate(formattedPhone, this.hiringInvitationTemplateId, [
      ...buildHiringInvitationTemplateParameters(params.code)
    ]);
  }

  async sendHiringCorrection(params: {
    phoneNumber: string;
    details: string;
    replacementCode: string;
  }): Promise<{ success: boolean; messageId?: number; error?: string; rawResponse?: unknown }> {
    if (this.environment === 'sandbox' && !this.apiKey) return { success: true };
    if (!Number.isInteger(this.hiringCorrectionTemplateId) || this.hiringCorrectionTemplateId <= 0) {
      return { success: false, error: 'قالب پیامک درخواست اصلاح استخدام تنظیم نشده است.' };
    }
    const formattedPhone = this.formatPhoneNumber(params.phoneNumber);
    const parameters = buildHiringCorrectionTemplateParameters(params.details, params.replacementCode);
    return this.sendTemplate(formattedPhone, this.hiringCorrectionTemplateId, parameters);
  }

  async sendHiringOfferReady(params: {
    phoneNumber: string;
    code: string;
  }): Promise<{ success: boolean; messageId?: number; error?: string; rawResponse?: unknown }> {
    if (this.environment === 'sandbox' && !this.apiKey) return { success: true };
    if (!Number.isInteger(this.hiringOfferTemplateId) || this.hiringOfferTemplateId <= 0) {
      return { success: false, error: 'قالب پیامک آماده‌شدن پیشنهاد همکاری تنظیم نشده است.' };
    }
    return this.sendTemplate(
      this.formatPhoneNumber(params.phoneNumber),
      this.hiringOfferTemplateId,
      buildHiringOfferTemplateParameters(params.code)
    );
  }

  private async sendTemplate(
    formattedPhone: string,
    templateId: number,
    parameters: SmsTemplateParameter[]
  ): Promise<SmsSendResult> {
    try {
      console.info('[sms.ir] sending template SMS', {
        templateId,
        mobile: maskPhoneNumber(formattedPhone),
        parameterNames: parameters.map((parameter) => parameter.name)
      });

      const response = await axios.post<SendVerificationCodeResponse>(
        `${this.apiUrl}/send/verify`,
        {
          mobile: formattedPhone,
          templateId,
          parameters
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/plain',
            'x-api-key': this.apiKey
          },
          timeout: this.requestTimeoutMs,
          httpAgent: this.httpAgent,
          httpsAgent: this.httpsAgent
        }
      );

      if (response.data.status === 1) {
        console.info('[sms.ir] template SMS accepted', {
          templateId,
          mobile: maskPhoneNumber(formattedPhone),
          messageId: response.data.data?.messageId
        });

        return {
          success: true,
          messageId: response.data.data?.messageId,
          rawResponse: response.data
        };
      }

      console.warn('[sms.ir] template SMS rejected', {
        templateId,
        mobile: maskPhoneNumber(formattedPhone),
        status: response.data.status,
        message: response.data.message
      });

      return {
        success: false,
        error: response.data.message || 'Failed to send SMS',
        rawResponse: response.data,
        failureKind: 'PROVIDER_REJECTION'
      };
    } catch (error: any) {
      if (error.response) {
        console.error('[sms.ir] template SMS request failed', {
          templateId,
          mobile: maskPhoneNumber(formattedPhone),
          status: error.response.status,
          message: error.response.data?.message || error.response.data?.error
        });

        return {
          success: false,
          error: error.response.data?.message || error.response.data?.error || 'SMS API error',
          rawResponse: error.response?.data,
          failureKind: 'HTTP',
          httpStatus: error.response.status
        };
      }

      console.error('[sms.ir] template SMS request failed', {
        templateId,
        mobile: maskPhoneNumber(formattedPhone),
        code: error.code,
        timeoutMs: this.requestTimeoutMs,
        dnsServers: this.dnsServers.length > 0 ? this.dnsServers : undefined,
        message: error.message
      });

      return {
        success: false,
        error: error.message || 'Failed to send SMS',
        failureKind: 'NETWORK',
        errorCode: error.code
      };
    }
  }

  async sendDispatchConfirmationOtp(params: { phoneNumber: string; dispatchNumber: string; code: string }): Promise<SmsSendResult> {
    if (this.environment === 'sandbox' && !this.apiKey) return { success: true, messageId: undefined };
    if (!Number.isInteger(this.dispatchConfirmationOtpTemplateId) || this.dispatchConfirmationOtpTemplateId <= 0) {
      return { success: false, error: 'Dispatch confirmation OTP template is not configured.' };
    }
    return this.sendTemplate(
      this.formatPhoneNumber(params.phoneNumber),
      this.dispatchConfirmationOtpTemplateId,
      buildDispatchConfirmationOtpTemplateParameters(params.dispatchNumber, params.code)
    );
  }

  async sendDispatchExitNotice(params: { phoneNumber: string; dispatchNumber: string; vehiclePlate: string }): Promise<SmsSendResult> {
    if (this.environment === 'sandbox' && !this.apiKey) return { success: true, messageId: undefined };
    if (!Number.isInteger(this.dispatchExitTemplateId) || this.dispatchExitTemplateId <= 0) {
      return { success: false, error: 'Dispatch exit SMS template is not configured.' };
    }
    return this.sendTemplate(
      this.formatPhoneNumber(params.phoneNumber),
      this.dispatchExitTemplateId,
      buildDispatchExitTemplateParameters(params.dispatchNumber, params.vehiclePlate)
    );
  }

  async sendDispatchExitManualRetryNotice(params: { phoneNumber: string; dispatchNumber: string; vehiclePlate: string }): Promise<SmsSendResult> {
    if (this.environment === 'sandbox' && !this.apiKey) return { success: true, messageId: undefined };
    if (!Number.isInteger(this.dispatchExitManualRetryTemplateId) || this.dispatchExitManualRetryTemplateId <= 0) {
      return { success: false, error: 'Dispatch exit manual-retry SMS template is not configured.' };
    }
    return this.sendTemplate(
      this.formatPhoneNumber(params.phoneNumber),
      this.dispatchExitManualRetryTemplateId,
      buildDispatchExitTemplateParameters(params.dispatchNumber, params.vehiclePlate)
    );
  }

  async getDeliveryReport(messageId: number): Promise<{
    success: boolean;
    deliveryState?: number | null;
    deliveryDateTime?: number | null;
    error?: string;
    rawResponse?: unknown;
  }> {
    try {
      if (!this.apiKey) return { success: false, error: 'SMS API key is not configured' };
      const response = await axios.get(`${this.apiUrl}/send/${messageId}`, {
        headers: { Accept: 'application/json', 'x-api-key': this.apiKey },
        timeout: this.requestTimeoutMs,
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent
      });
      if (response.data?.status !== 1) {
        return { success: false, error: response.data?.message || 'SMS delivery report failed', rawResponse: response.data };
      }
      return {
        success: true,
        deliveryState: response.data?.data?.deliveryState ?? null,
        deliveryDateTime: response.data?.data?.deliveryDateTime ?? null,
        rawResponse: response.data
      };
    } catch (error: any) {
      return { success: false, error: error.response?.data?.message || error.message || 'SMS delivery report failed', rawResponse: error.response?.data };
    }
  }

  /**
   * Check if SMS service is configured
   * @returns true if API key is set
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Get current environment (sandbox or production)
   * @returns Environment string
   */
  getEnvironment(): string {
    return this.environment;
  }
}

// Export singleton instance
export const smsService = new SmsService();
export default smsService;

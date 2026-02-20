/**
 * SMS Service for sms.ir API Integration
 * Handles sending verification codes via sms.ir RESTful API
 */

import axios from 'axios';

interface SendVerificationCodeResponse {
  status: number;
  message: string;
  data?: {
    messageId: number;
    cost?: number;
  };
}

interface SmsTemplateParameter {
  name: string;
  value: string;
}

class SmsService {
  private apiKey: string;
  private apiUrl: string;
  private templateId: number;
  private contractConfirmationTemplateId: number;
  private environment: string;

  constructor() {
    this.apiKey = process.env.SMS_IR_API_KEY || '';
    this.apiUrl = process.env.SMS_IR_API_URL || 'https://api.sms.ir/v1';
    this.templateId = parseInt(process.env.SMS_IR_TEMPLATE_ID || '123456', 10);
    this.contractConfirmationTemplateId = parseInt(
      process.env.SMS_IR_CONTRACT_CONFIRM_TEMPLATE_ID || String(this.templateId),
      10
    );
    this.environment = process.env.SMS_IR_ENVIRONMENT || 'sandbox';

    if (!this.apiKey) {
      console.warn('SMS_IR_API_KEY is not set in environment variables');
    }
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
  ): Promise<{ success: boolean; messageId?: number; error?: string; rawResponse?: unknown }> {
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
    confirmationLink: string;
  }): Promise<{ success: boolean; messageId?: number; error?: string; rawResponse?: unknown }> {
    const formattedPhone = this.formatPhoneNumber(params.phoneNumber);
    return this.sendTemplate(formattedPhone, this.contractConfirmationTemplateId, [
      { name: 'Name', value: params.customerName },
      { name: 'ContractNumber', value: params.contractNumber },
      { name: 'Link', value: params.confirmationLink },
      { name: 'Code', value: params.code }
    ]);
  }

  private async sendTemplate(
    formattedPhone: string,
    templateId: number,
    parameters: SmsTemplateParameter[]
  ): Promise<{ success: boolean; messageId?: number; error?: string; rawResponse?: unknown }> {
    try {
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
          timeout: 10000
        }
      );

      if (response.data.status === 1) {
        return {
          success: true,
          messageId: response.data.data?.messageId,
          rawResponse: response.data
        };
      }

      return {
        success: false,
        error: response.data.message || 'Failed to send SMS',
        rawResponse: response.data
      };
    } catch (error: any) {
      if (error.response) {
        return {
          success: false,
          error: error.response.data?.message || error.response.data?.error || 'SMS API error',
          rawResponse: error.response?.data
        };
      }

      return {
        success: false,
        error: error.message || 'Failed to send SMS'
      };
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


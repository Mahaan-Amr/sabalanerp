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

class SmsService {
  private apiKey: string;
  private apiUrl: string;
  private templateId: number;
  private environment: string;

  constructor() {
    this.apiKey = process.env.SMS_IR_API_KEY || '';
    this.apiUrl = process.env.SMS_IR_API_URL || 'https://api.sms.ir/v1';
    this.templateId = parseInt(process.env.SMS_IR_TEMPLATE_ID || '123456', 10);
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
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    try {
      // Validate API key
      if (!this.apiKey) {
        throw new Error('SMS API key is not configured');
      }

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // Prepare request
      const requestBody = {
        mobile: formattedPhone,
        templateId: this.templateId,
        parameters: [
          {
            name: 'Code',
            value: code
          }
        ]
      };

      // Send request to sms.ir API
      const response = await axios.post<SendVerificationCodeResponse>(
        `${this.apiUrl}/send/verify`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/plain',
            'x-api-key': this.apiKey
          },
          timeout: 10000 // 10 second timeout
        }
      );

      // Check response
      if (response.data.status === 1) {
        return {
          success: true,
          messageId: response.data.data?.messageId
        };
      } else {
        return {
          success: false,
          error: response.data.message || 'Failed to send SMS'
        };
      }
    } catch (error: any) {
      console.error('SMS sending error:', error);
      
      // Handle axios errors
      if (error.response) {
        // API returned error response
        const errorMessage = error.response.data?.message || error.response.data?.error || 'SMS API error';
        return {
          success: false,
          error: errorMessage
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


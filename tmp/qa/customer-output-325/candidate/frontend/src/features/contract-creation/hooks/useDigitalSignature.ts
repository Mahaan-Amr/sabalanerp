// useDigitalSignature Hook
// Manages SMS verification and digital signature state

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseDigitalSignatureOptions {
  onCodeSent?: () => void;
  onCodeVerified?: () => void;
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

export const useDigitalSignature = (options: UseDigitalSignatureOptions = {}) => {
  const { onCodeSent, onCodeVerified, onError, onSuccess } = options;

  // Use refs to store callbacks to avoid dependency issues
  const onErrorRef = useRef(onError);
  const onSuccessRef = useRef(onSuccess);
  const onCodeSentRef = useRef(onCodeSent);
  const onCodeVerifiedRef = useRef(onCodeVerified);
  
  // Keep refs in sync with callbacks
  useEffect(() => {
    onErrorRef.current = onError;
    onSuccessRef.current = onSuccess;
    onCodeSentRef.current = onCodeSent;
    onCodeVerifiedRef.current = onCodeVerified;
  }, [onError, onSuccess, onCodeSent, onCodeVerified]);

  // Code sending state
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  
  // Countdown timers
  const [countdown, setCountdown] = useState<number | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  
  // Messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sandboxVerificationCode, setSandboxVerificationCode] = useState<string | null>(null);
  
  // Refs for intervals
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const resendCooldownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clear countdown interval
  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(null);
  }, []);

  // Clear resend cooldown interval
  const clearResendCooldown = useCallback(() => {
    if (resendCooldownIntervalRef.current) {
      clearInterval(resendCooldownIntervalRef.current);
      resendCooldownIntervalRef.current = null;
    }
    setResendCooldown(0);
  }, []);

  // Start countdown timer
  const startCountdown = useCallback((seconds: number) => {
    clearCountdown();
    setCountdown(seconds);
    
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearCountdown();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearCountdown]);

  // Start resend cooldown timer
  const startResendCooldown = useCallback((seconds: number) => {
    clearResendCooldown();
    setResendCooldown(seconds);
    
    resendCooldownIntervalRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) {
          clearResendCooldown();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearResendCooldown]);

  // Clear error message
  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  // Clear success message
  const clearSuccess = useCallback(() => {
    setSuccessMessage(null);
  }, []);

  // Set error message - use ref to avoid dependency issues
  const setError = useCallback((error: string | null) => {
    setErrorMessage(error);
    if (error && onErrorRef.current) {
      onErrorRef.current(error);
    }
  }, []);

  // Set success message - use ref to avoid dependency issues
  const setSuccess = useCallback((message: string | null) => {
    setSuccessMessage(message);
    if (message && onSuccessRef.current) {
      onSuccessRef.current(message);
    }
  }, []);

  // Reset all state
  const reset = useCallback(() => {
    setSendingCode(false);
    setVerifyingCode(false);
    clearCountdown();
    clearResendCooldown();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSandboxVerificationCode(null);
  }, [clearCountdown, clearResendCooldown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearCountdown();
      clearResendCooldown();
    };
  }, [clearCountdown, clearResendCooldown]);

  return {
    // State
    sendingCode,
    setSendingCode,
    verifyingCode,
    setVerifyingCode,
    countdown,
    resendCooldown,
    errorMessage,
    successMessage,
    sandboxVerificationCode,
    setSandboxVerificationCode,
    
    // Actions
    startCountdown,
    startResendCooldown,
    clearCountdown,
    clearResendCooldown,
    setError,
    setSuccess,
    clearError,
    clearSuccess,
    reset,
    
    // Computed
    canResend: resendCooldown === 0,
    isCountdownActive: countdown !== null && countdown > 0
  };
};


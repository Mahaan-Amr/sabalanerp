-- Historical OTP sessions remain readable; application commands no longer authorize them.
ALTER TABLE "dispatch_confirmation_sessions" DROP CONSTRAINT "dispatch_confirmation_sessions_method_check";
ALTER TABLE "dispatch_confirmation_sessions" ADD CONSTRAINT "dispatch_confirmation_sessions_method_check"
 CHECK ("method" IN ('INTERNAL_BIOMETRIC','INTERNAL_FALLBACK','EXTERNAL_OTP_GUARD','EXTERNAL_BIOMETRIC','EXTERNAL_FALLBACK'));

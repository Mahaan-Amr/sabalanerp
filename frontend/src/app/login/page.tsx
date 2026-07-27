'use client';
import { ErpInput, ErpPressable } from '@/components/erp';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaEye, FaEyeSlash, FaUser, FaLock, FaArrowRight } from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';
import { authAPI } from '@/lib/api';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    identifier: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const router = useRouter();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.identifier.trim()) {
      newErrors.identifier = 'ایمیل، نام کاربری یا شماره تماس الزامی است';
    }

    if (!formData.password.trim()) {
      newErrors.password = 'رمز عبور الزامی است';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const response = await authAPI.login(formData.identifier, formData.password);
      const data = response.data;

      if (data.success) {
        router.push(data.data.mustChangePassword ? '/change-password' : '/dashboard');
      } else {
        setErrors({ general: data.error || 'ورود ناموفق بود' });
      }
    } catch (error: any) {
      console.error('Login error:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      console.error('Error message:', error.message);

      if (error.response?.data?.error) {
        setErrors({ general: error.response.data.error });
      } else if (error.code === 'ECONNREFUSED' || error.message.includes('Network Error')) {
        setErrors({ general: 'خطا در اتصال به سرور. لطفا اتصال اینترنت و سرویس را بررسی کنید.' });
      } else {
        setErrors({ general: 'خطا در ورود به حساب' });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="sds-workspace min-h-screen bg-gradient-to-br from-[var(--sds-surface-raised)] via-[var(--sds-surface-raised)] to-[var(--sds-surface-raised)] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="sds-workspace-surface p-4">
              <FaUser className="h-12 w-12 text-[var(--sds-accent)]" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-[var(--sds-text-primary)] mb-2">ورود به حساب</h1>
          <p className="text-[var(--sds-text-muted)]">برای استفاده از سامانه ERP وارد شوید</p>
        </div>

        {/* Login Form */}
        <div className="sds-workspace-surface p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* General Error */}
            {errors.general && (
              <div className="bg-[var(--sds-danger-surface)] border border-[var(--sds-danger-border)] rounded-lg p-4">
                <p className="text-[var(--sds-danger)] text-sm">{errors.general}</p>
              </div>
            )}

            {/* Login Identifier Field */}
            <div>
              <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">
                ایمیل، نام کاربری یا شماره تماس
              </label>
              <div className="relative">
                <FaUser className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--sds-text-muted)]" />
                <ErpInput
                  type="text"
                  name="identifier"
                  value={formData.identifier}
                  onChange={handleInputChange}
                  className={`sds-field w-full pr-10 ${errors.identifier ? 'border-[var(--sds-danger-border)]' : ''}`}
                  placeholder="ایمیل، نام کاربری یا شماره تماس"
                  dir="ltr"
                />
              </div>
              {errors.identifier && <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.identifier}</p>}
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-sm font-medium text-[var(--sds-text-muted)] mb-2">
                رمز عبور
              </label>
              <div className="relative">
                <FaLock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--sds-text-muted)]" />
                <ErpInput
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className={`sds-field w-full pr-10 pl-10 ${errors.password ? 'border-[var(--sds-danger-border)]' : ''}`}
                  placeholder="رمز عبور خود را وارد کنید"
                />
                <ErpPressable
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--sds-text-muted)] hover:text-[var(--sds-text-muted)]"
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </ErpPressable>
              </div>
              {errors.password && <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.password}</p>}
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <ErpInput
                  type="checkbox"
                  className="rounded border-[var(--sds-border-default)] text-[var(--sds-accent)] focus:ring-[var(--sds-focus-ring)]"
                />
                <span className="mr-2 text-sm text-[var(--sds-text-muted)]">مرا به خاطر بسپار</span>
              </label>
              <Link href="/forgot-password" className="text-sm text-[var(--sds-accent)] hover:text-[var(--sds-accent)]">
                فراموشی رمز عبور
              </Link>
            </div>

            {/* Submit Button */}
            <ErpPressable
              type="submit"
              disabled={loading}
              className="sds-action sds-tone-primary sds-action-solid w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--sds-border-default)]"></div>
              ) : (
                <>
                  <span>ورود</span>
                  <FaArrowRight />
                </>
              )}
            </ErpPressable>
          </form>
        </div>

        {/* Register Link */}
        <div className="text-center mt-6">
          <p className="text-[var(--sds-text-muted)]">
            حساب کاربری ندارید؟{' '}
            <span className="text-[var(--sds-text-muted)]">ساخت حساب توسط مدیر سیستم انجام می‌شود</span>
          </p>
        </div>

        {/* Theme Toggle */}
        <div className="flex justify-center mt-6">
          <ThemeToggle />
        </div>
      </div>
    </main>
  );
}


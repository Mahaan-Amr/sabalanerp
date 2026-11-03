'use client';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpIconButton, ErpInlineState, ErpInput } from '@/components/erp';
import { useState } from 'react';
import Link from 'next/link';
import { FaEye, FaEyeSlash, FaUser, FaArrowRight } from 'react-icons/fa';
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
        const storedReturnTo = sessionStorage.getItem('post-login-return-to');
        const returnTo = storedReturnTo?.startsWith('/dashboard') && !storedReturnTo.startsWith('//')
          ? storedReturnTo
          : '/dashboard';
        sessionStorage.removeItem('post-login-return-to');
        // Authentication providers live above this route. A document navigation
        // makes every provider read the newly issued HttpOnly session before any
        // protected workspace or realtime request can start.
        window.location.assign(data.data.mustChangePassword ? '/change-password' : returnTo);
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
    <main className="sds-workspace flex min-h-screen items-center justify-center bg-[var(--sds-surface-canvas)] p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <ErpCard className="p-4">
              <FaUser className="h-12 w-12 text-[var(--sds-accent)]" />
            </ErpCard>
          </div>
          <h1 className="text-3xl font-bold text-[var(--sds-text-primary)] mb-2">ورود به حساب</h1>
          <p className="text-[var(--sds-text-muted)]">برای استفاده از سامانه ERP وارد شوید</p>
        </div>

        {/* Login Form */}
        <ErpCard className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* General Error */}
            {errors.general && <ErpInlineState kind="error" title={errors.general} />}

            {/* Login Identifier Field */}
            <ErpField label="ایمیل، نام کاربری یا شماره تماس" error={errors.identifier}>
              <ErpInput
                type="text"
                name="identifier"
                value={formData.identifier}
                onChange={handleInputChange}
                placeholder="ایمیل، نام کاربری یا شماره تماس"
                dir="ltr"
              />
            </ErpField>

            {/* Password Field */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <ErpField label="رمز عبور" error={errors.password}>
                <ErpInput
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="رمز عبور خود را وارد کنید"
                />
              </ErpField>
              <ErpIconButton
                label={showPassword ? 'پنهان‌کردن رمز' : 'نمایش رمز'}
                icon={showPassword ? FaEyeSlash : FaEye}
                onClick={() => setShowPassword(!showPassword)}
              />
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <ErpCheckbox label="مرا به خاطر بسپار" />
              <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-sm text-[var(--sds-accent)] hover:text-[var(--sds-accent)]">
                فراموشی رمز عبور
              </Link>
            </div>

            {/* Submit Button */}
            <ErpButton type="submit" label={loading ? 'در حال ورود...' : 'ورود'} icon={FaArrowRight} disabled={loading} variant="solid" className="w-full" />
          </form>
        </ErpCard>

        {/* Register Link */}
        <div className="text-center mt-6">
          <p className="text-[var(--sds-text-secondary)]">
            حساب کاربری ندارید؟{' '}
            <span>ساخت حساب توسط مدیر سیستم انجام می‌شود</span>
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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaEye, FaEyeSlash, FaUser, FaLock, FaEnvelope, FaBuilding, FaArrowRight } from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';
import { authAPI } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  namePersian: string;
}

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    departmentId: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const router = useRouter();

  // Mock departments - replace with actual API call
  const departments: Department[] = [
    { id: '1', name: 'Sales Marketing', namePersian: 'فروش و بازاریابی' },
    { id: '2', name: 'Workshop', namePersian: 'کارگاه' },
    { id: '3', name: 'Customer Affairs', namePersian: 'امور مشتریان' },
    { id: '4', name: 'Finance', namePersian: 'مالی و حساب داری' },
    { id: '5', name: 'Warehouse', namePersian: 'انبار' },
    { id: '6', name: 'Security', namePersian: 'انتظامات' },
    { id: '7', name: 'Procurement', namePersian: 'کارپرداز' },
    { id: '8', name: 'Management', namePersian: 'مدیریت' }
  ];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'نام الزامی است';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'نام خانوادگی الزامی است';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'ایمیل الزامی است';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'فرمت ایمیل صحیح نیست';
    }

    if (!formData.username.trim()) {
      newErrors.username = 'نام کاربری الزامی است';
    } else if (formData.username.length < 3) {
      newErrors.username = 'نام کاربری باید حداقل 3 کاراکتر باشد';
    }

    if (!formData.password.trim()) {
      newErrors.password = 'رمز عبور الزامی است';
    } else if (formData.password.length < 6) {
      newErrors.password = 'رمز عبور باید حداقل 6 کاراکتر باشد';
    }

    if (!formData.confirmPassword.trim()) {
      newErrors.confirmPassword = 'تکرار رمز عبور الزامی است';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'رمز عبور و تکرار آن یکسان نیستند';
    }

    if (!formData.departmentId) {
      newErrors.departmentId = 'انتخاب بخش الزامی است';
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
      const response = await authAPI.register({
        email: formData.email,
        username: formData.username,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName
      });
      const data = response.data;

      if (data.success) {
        // Store token and user data
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('user', JSON.stringify(data.data.user));
        
        // Redirect to dashboard
        router.push('/dashboard');
      } else {
        setErrors({ general: data.error || 'خطا در ثبت نام' });
      }
    } catch (error) {
      console.error('Register error:', error);
      setErrors({ general: 'خطا در ارتباط با سرور' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="glass-liquid-card p-4">
              <FaUser className="h-12 w-12 text-teal-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">ثبت نام</h1>
          <p className="text-gray-300">حساب کاربری جدید ایجاد کنید</p>
        </div>

        {/* Register Form */}
        <div className="glass-liquid-card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* General Error */}
            {errors.general && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                <p className="text-red-400 text-sm">{errors.general}</p>
              </div>
            )}

            {/* Name Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  نام
                </label>
                <div className="relative">
                  <FaUser className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    className={`glass-liquid-input w-full pr-10 ${errors.firstName ? 'border-red-500' : ''}`}
                    placeholder="نام"
                  />
                </div>
                {errors.firstName && <p className="text-red-400 text-sm mt-1">{errors.firstName}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  نام خانوادگی
                </label>
                <div className="relative">
                  <FaUser className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    className={`glass-liquid-input w-full pr-10 ${errors.lastName ? 'border-red-500' : ''}`}
                    placeholder="نام خانوادگی"
                  />
                </div>
                {errors.lastName && <p className="text-red-400 text-sm mt-1">{errors.lastName}</p>}
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                ایمیل
              </label>
              <div className="relative">
                <FaEnvelope className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className={`glass-liquid-input w-full pr-10 ${errors.email ? 'border-red-500' : ''}`}
                  placeholder="ایمیل خود را وارد کنید"
                  dir="ltr"
                />
              </div>
              {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email}</p>}
            </div>

            {/* Username Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                نام کاربری
              </label>
              <div className="relative">
                <FaUser className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  className={`glass-liquid-input w-full pr-10 ${errors.username ? 'border-red-500' : ''}`}
                  placeholder="نام کاربری"
                  dir="ltr"
                />
              </div>
              {errors.username && <p className="text-red-400 text-sm mt-1">{errors.username}</p>}
            </div>

            {/* Department Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                بخش
              </label>
              <div className="relative">
                <FaBuilding className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <select
                  name="departmentId"
                  value={formData.departmentId}
                  onChange={handleInputChange}
                  className={`glass-liquid-input w-full pr-10 ${errors.departmentId ? 'border-red-500' : ''}`}
                >
                  <option value="">انتخاب بخش</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.namePersian}
                    </option>
                  ))}
                </select>
              </div>
              {errors.departmentId && <p className="text-red-400 text-sm mt-1">{errors.departmentId}</p>}
            </div>

            {/* Password Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  رمز عبور
                </label>
                <div className="relative">
                  <FaLock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className={`glass-liquid-input w-full pr-10 pl-10 ${errors.password ? 'border-red-500' : ''}`}
                    placeholder="رمز عبور"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  >
                    {showPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>
                {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  تکرار رمز عبور
                </label>
                <div className="relative">
                  <FaLock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className={`glass-liquid-input w-full pr-10 pl-10 ${errors.confirmPassword ? 'border-red-500' : ''}`}
                    placeholder="تکرار رمز عبور"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  >
                    {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-red-400 text-sm mt-1">{errors.confirmPassword}</p>}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="glass-liquid-btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <>
                  <span>ثبت نام</span>
                  <FaArrowRight />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Login Link */}
        <div className="text-center mt-6">
          <p className="text-gray-300">
            قبلاً حساب کاربری دارید؟{' '}
            <Link href="/login" className="text-teal-400 hover:text-teal-300 font-medium">
              وارد شوید
            </Link>
          </p>
        </div>

        {/* Theme Toggle */}
        <div className="flex justify-center mt-6">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaEye, FaEyeSlash, FaUser, FaLock, FaArrowRight } from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';
import { authAPI } from '@/lib/api';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: '',
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

    if (!formData.email.trim()) {
      newErrors.email = '??? ??? ??';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = '?? ??? ?? ??';
    }

    if (!formData.password.trim()) {
      newErrors.password = '?? ?? ??? ??';
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
      const response = await authAPI.login(formData.email, formData.password);
      const data = response.data;

      if (data.success) {
        // Store token and user data
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('user', JSON.stringify(data.data.user));
        
        // Role-based redirection
        const userRole = data.data.user.role;
        if (userRole === 'SALES') {
          router.push('/dashboard/sales');
        } else {
          router.push('/dashboard');
        }
      } else {
        setErrors({ general: data.error || '?? ? ??' });
      }
    } catch (error: any) {
      console.error('Login error:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      console.error('Error message:', error.message);
      
      if (error.response?.data?.error) {
        setErrors({ general: error.response.data.error });
      } else if (error.code === 'ECONNREFUSED' || error.message.includes('Network Error')) {
        setErrors({ general: '?? ? ??? ??. ??? ??? ?? ?? ? ??? ??.' });
      } else {
        setErrors({ general: '?? ? ??? ? ??' });
      }
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
          <h1 className="text-3xl font-bold text-white mb-2">?? ? ???</h1>
          <p className="text-gray-300">? ?? ??? ??? ERP ?? ???</p>
        </div>

        {/* Login Form */}
        <div className="glass-liquid-card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* General Error */}
            {errors.general && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                <p className="text-red-400 text-sm">{errors.general}</p>
              </div>
            )}

            {/* Email Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                ???
              </label>
              <div className="relative">
                <FaUser className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className={`glass-liquid-input w-full pr-10 ${errors.email ? 'border-red-500' : ''}`}
                  placeholder="??? ?? ? ?? ??"
                  dir="ltr"
                />
              </div>
              {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email}</p>}
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                ?? ??
              </label>
              <div className="relative">
                <FaLock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className={`glass-liquid-input w-full pr-10 pl-10 ${errors.password ? 'border-red-500' : ''}`}
                  placeholder="?? ?? ?? ? ?? ??"
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

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="mr-2 text-sm text-gray-300">?? ? ?? ???</span>
              </label>
              <Link href="/forgot-password" className="text-sm text-teal-400 hover:text-teal-300">
                ?? ?? ???
              </Link>
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
                  <span>??</span>
                  <FaArrowRight />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Register Link */}
        <div className="text-center mt-6">
          <p className="text-gray-300">
            ?? ??? ??{' '}
            <Link href="/register" className="text-teal-400 hover:text-teal-300 font-medium">
              ?? ?? ??
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


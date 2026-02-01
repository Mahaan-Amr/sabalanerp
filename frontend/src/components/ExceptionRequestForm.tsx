'use client';

import { useState } from 'react';
import { FaCalendarAlt, FaClock, FaFileAlt, FaUser, FaPhone } from 'react-icons/fa';
import PersianCalendarComponent from './PersianCalendar';

interface ExceptionRequestFormProps {
  onSubmit: (data: any) => void;
  onCancel: () => void;
  loading?: boolean;
}

const exceptionTypes = [
  { value: 'HOURLY_LEAVE', label: 'مرخصی ساعتی' },
  { value: 'SICK_LEAVE', label: 'مرخصی استعلاجی' },
  { value: 'VACATION', label: 'مرخصی استحقاقی' },
  { value: 'EMERGENCY_LEAVE', label: 'مرخصی اضطراری' },
  { value: 'PERSONAL_LEAVE', label: 'مرخصی شخصی' }
];

export default function ExceptionRequestForm({ onSubmit, onCancel, loading = false }: ExceptionRequestFormProps) {
  const [formData, setFormData] = useState({
    exceptionType: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    duration: '',
    reason: '',
    description: '',
    emergencyContact: ''
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.exceptionType) newErrors.exceptionType = 'نوع استثنا الزامی است';
    if (!formData.startDate) newErrors.startDate = 'تاریخ شروع الزامی است';
    if (!formData.reason) newErrors.reason = 'دلیل الزامی است';

    // For hourly leave, require start and end time
    if (formData.exceptionType === 'HOURLY_LEAVE') {
      if (!formData.startTime) newErrors.startTime = 'ساعت شروع الزامی است';
      if (!formData.endTime) newErrors.endTime = 'ساعت پایان الزامی است';
    }

    // For sick leave, require emergency contact
    if (formData.exceptionType === 'SICK_LEAVE' && !formData.emergencyContact) {
      newErrors.emergencyContact = 'تماس اضطراری برای مرخصی استعلاجی الزامی است';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  const isHourlyLeave = formData.exceptionType === 'HOURLY_LEAVE';
  const isSickLeave = formData.exceptionType === 'SICK_LEAVE';

  return (
    <div className="glass-liquid-card p-6">
      <h2 className="text-2xl font-bold text-primary mb-6 text-right">درخواست استثنا</h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Exception Type */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            نوع استثنا *
          </label>
          <select
            value={formData.exceptionType}
            onChange={(e) => handleInputChange('exceptionType', e.target.value)}
            className={`glass-liquid-input w-full ${errors.exceptionType ? 'border-red-500' : ''}`}
          >
            <option value="">انتخاب نوع استثنا</option>
            {exceptionTypes.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          {errors.exceptionType && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.exceptionType}</p>
          )}
        </div>

        {/* Start Date */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            تاریخ شروع *
          </label>
          <PersianCalendarComponent
            value={formData.startDate}
            onChange={(date) => handleInputChange('startDate', date)}
            placeholder="انتخاب تاریخ شروع"
            className={errors.startDate ? 'border-red-500' : ''}
          />
          {errors.startDate && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.startDate}</p>
          )}
        </div>

        {/* End Date (Optional) */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            تاریخ پایان
          </label>
          <PersianCalendarComponent
            value={formData.endDate}
            onChange={(date) => handleInputChange('endDate', date)}
            placeholder="انتخاب تاریخ پایان (اختیاری)"
          />
        </div>

        {/* Time Fields for Hourly Leave */}
        {isHourlyLeave && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-primary mb-2 text-right">
                ساعت شروع *
              </label>
              <input
                type="time"
                value={formData.startTime}
                onChange={(e) => handleInputChange('startTime', e.target.value)}
                className={`glass-liquid-input w-full ${errors.startTime ? 'border-red-500' : ''}`}
              />
              {errors.startTime && (
                <p className="text-red-500 text-sm mt-1 text-right">{errors.startTime}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-primary mb-2 text-right">
                ساعت پایان *
              </label>
              <input
                type="time"
                value={formData.endTime}
                onChange={(e) => handleInputChange('endTime', e.target.value)}
                className={`glass-liquid-input w-full ${errors.endTime ? 'border-red-500' : ''}`}
              />
              {errors.endTime && (
                <p className="text-red-500 text-sm mt-1 text-right">{errors.endTime}</p>
              )}
            </div>
          </div>
        )}

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            مدت (ساعت)
          </label>
          <input
            type="number"
            min="1"
            value={formData.duration}
            onChange={(e) => handleInputChange('duration', e.target.value)}
            className="glass-liquid-input w-full"
            placeholder="مدت زمان به ساعت"
          />
        </div>

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            دلیل *
          </label>
          <textarea
            value={formData.reason}
            onChange={(e) => handleInputChange('reason', e.target.value)}
            className={`glass-liquid-input w-full h-24 resize-none ${errors.reason ? 'border-red-500' : ''}`}
            placeholder="دلیل درخواست استثنا را توضیح دهید"
          />
          {errors.reason && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.reason}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            توضیحات اضافی
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            className="glass-liquid-input w-full h-20 resize-none"
            placeholder="توضیحات اضافی (اختیاری)"
          />
        </div>

        {/* Emergency Contact for Sick Leave */}
        {isSickLeave && (
          <div>
            <label className="block text-sm font-medium text-primary mb-2 text-right">
              تماس اضطراری *
            </label>
            <input
              type="text"
              value={formData.emergencyContact}
              onChange={(e) => handleInputChange('emergencyContact', e.target.value)}
              className={`glass-liquid-input w-full ${errors.emergencyContact ? 'border-red-500' : ''}`}
              placeholder="شماره تماس اضطراری"
            />
            {errors.emergencyContact && (
              <p className="text-red-500 text-sm mt-1 text-right">{errors.emergencyContact}</p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4 space-x-reverse pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="glass-liquid-btn px-6 py-3"
            disabled={loading}
          >
            انصراف
          </button>
          <button
            type="submit"
            className="glass-liquid-btn-primary px-6 py-3"
            disabled={loading}
          >
            {loading ? 'در حال ارسال...' : 'ارسال درخواست'}
          </button>
        </div>
      </form>
    </div>
  );
}

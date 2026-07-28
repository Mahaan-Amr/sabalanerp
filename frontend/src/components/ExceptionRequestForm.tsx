'use client';

import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
import { useEffect, useState } from 'react';
import { FaCalendarAlt, FaClock, FaFileAlt, FaUser, FaPhone } from 'react-icons/fa';
import PersianCalendarComponent from './PersianCalendar';
import EnhancedDropdown from './EnhancedDropdown';
import { personnelAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

interface ExceptionRequestFormProps {
  onSubmit: (data: any) => void;
  onCancel: () => void;
  loading?: boolean;
  initialData?: any;
}

const exceptionTypes = [
  { value: 'HOURLY_LEAVE', label: 'مرخصی ساعتی' },
  { value: 'SICK_LEAVE', label: 'مرخصی استعلاجی' },
  { value: 'VACATION', label: 'مرخصی روزانه' },
  { value: 'EMERGENCY_LEAVE', label: 'مرخصی اضطراری' },
  { value: 'PERSONAL_LEAVE', label: 'مرخصی شخصی' }
];

export default function ExceptionRequestForm({ onSubmit, onCancel, loading = false, initialData }: ExceptionRequestFormProps) {
  const [formData, setFormData] = useState({
    personnelId: initialData?.personnelId || '',
    exceptionType: initialData?.exceptionType || '',
    startDate: initialData?.startDate || '',
    endDate: initialData?.endDate || '',
    startTime: initialData?.startTime || '',
    endTime: initialData?.endTime || '',
    duration: initialData?.duration || '',
    reason: initialData?.reason || '',
    description: initialData?.description || '',
    emergencyContact: initialData?.emergencyContact || ''
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [personnel, setPersonnel] = useState<any[]>([]);

  useEffect(() => {
    personnelAPI.getPersonnel({ includeInactive: false }).then((response) => setPersonnel(response.data.data || [])).catch(() => setPersonnel([]));
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.personnelId) newErrors.personnelId = 'انتخاب پرسنل الزامی است';
    if (!formData.exceptionType) newErrors.exceptionType = 'نوع استثناء الزامی است';
    if (!formData.startDate) newErrors.startDate = 'تاریخ شروع الزامی است';
    if (!formData.reason) newErrors.reason = 'دلیل الزامی است';

    // For hourly leave, require start and end time
    if (formData.exceptionType === 'HOURLY_LEAVE') {
      if (!formData.startTime) newErrors.startTime = 'زمان شروع الزامی است';
      if (!formData.endTime) newErrors.endTime = 'زمان پایان الزامی است';
    }

    // For sick leave, require emergency contact
    if (formData.exceptionType === 'SICK_LEAVE' && !formData.emergencyContact) {
      newErrors.emergencyContact = 'شماره تماس اضطراری الزامی است';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit({ ...formData, duration: formData.duration ? Number(formData.duration) : undefined, startDate: PersianCalendar.toGregorianDateOnly(formData.startDate), endDate: formData.endDate ? PersianCalendar.toGregorianDateOnly(formData.endDate) : undefined });
    }
  };

  const isHourlyLeave = formData.exceptionType === 'HOURLY_LEAVE';
  const isSickLeave = formData.exceptionType === 'SICK_LEAVE';

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium sds-text-primary mb-2 text-right">پرسنل *</label>
          <EnhancedDropdown value={formData.personnelId} onChange={(value) => handleInputChange('personnelId', value)} placeholder="انتخاب پرسنل" options={personnel.map((person) => ({ value: person.id, label: `${person.firstName} ${person.lastName} (${person.department?.namePersian || 'بدون بخش'})` }))} searchable required error={errors.personnelId} />
        </div>
        {/* Exception Type */}
        <div>
          <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
            نوع استثناء *
          </label>
          <EnhancedDropdown
            value={formData.exceptionType}
            onChange={(value) => handleInputChange('exceptionType', value)}
            placeholder="انتخاب نوع استثناء"
            options={exceptionTypes}
            searchable
            required
            error={errors.exceptionType}
          />
          {errors.exceptionType && (
            <p className="text-[var(--sds-danger)] text-sm mt-1 text-right">{errors.exceptionType}</p>
          )}
        </div>

        {/* Start Date */}
        <div>
          <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
            تاریخ شروع *
          </label>
          <PersianCalendarComponent
            value={formData.startDate}
            onChange={(date) => handleInputChange('startDate', date)}
            placeholder="انتخاب تاریخ شروع"
            className={errors.startDate ? 'border-[var(--sds-danger)]' : ''}
            disablePastDates
          />
          {errors.startDate && (
            <p className="text-[var(--sds-danger)] text-sm mt-1 text-right">{errors.startDate}</p>
          )}
        </div>

        {/* End Date (Optional) */}
        <div>
          <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
            تاریخ پایان
          </label>
          <PersianCalendarComponent
            value={formData.endDate}
            onChange={(date) => handleInputChange('endDate', date)}
            placeholder="انتخاب تاریخ پایان (اختیاری)"
            disablePastDates
          />
        </div>

        {/* Time Fields for Hourly Leave */}
        {isHourlyLeave && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
                زمان شروع *
              </label>
              <ErpInput
                type="time"
                value={formData.startTime}
                onChange={(e) => handleInputChange('startTime', e.target.value)}
                className={`sds-field w-full ${errors.startTime ? 'border-[var(--sds-danger)]' : ''}`}
              />
              {errors.startTime && (
                <p className="text-[var(--sds-danger)] text-sm mt-1 text-right">{errors.startTime}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
                زمان پایان *
              </label>
              <ErpInput
                type="time"
                value={formData.endTime}
                onChange={(e) => handleInputChange('endTime', e.target.value)}
                className={`sds-field w-full ${errors.endTime ? 'border-[var(--sds-danger)]' : ''}`}
              />
              {errors.endTime && (
                <p className="text-[var(--sds-danger)] text-sm mt-1 text-right">{errors.endTime}</p>
              )}
            </div>
          </div>
        )}

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
            مدت (دقیقه)
          </label>
          <ErpInput
            type="number"
            min="1"
            value={formData.duration}
            onChange={(e) => handleInputChange('duration', e.target.value)}
            className="sds-field w-full"
            placeholder="مدت زمان به دقیقه"
          />
        </div>

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
            دلیل *
          </label>
          <ErpTextarea
            value={formData.reason}
            onChange={(e) => handleInputChange('reason', e.target.value)}
            className={`sds-field w-full h-24 resize-none ${errors.reason ? 'border-[var(--sds-danger)]' : ''}`}
            placeholder="دلیل درخواست را وارد کنید"
          />
          {errors.reason && (
            <p className="text-[var(--sds-danger)] text-sm mt-1 text-right">{errors.reason}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
            توضیحات
          </label>
          <ErpTextarea
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            className="sds-field w-full h-20 resize-none"
            placeholder="توضیحات اضافی (اختیاری)"
          />
        </div>

        {/* Emergency Contact for Sick Leave */}
        {isSickLeave && (
          <div>
            <label className="block text-sm font-medium sds-text-primary mb-2 text-right">
              تماس اضطراری *
            </label>
            <ErpInput
              type="text"
              value={formData.emergencyContact}
              onChange={(e) => handleInputChange('emergencyContact', e.target.value)}
              className={`sds-field w-full ${errors.emergencyContact ? 'border-[var(--sds-danger)]' : ''}`}
              placeholder="شماره تماس اضطراری"
            />
            {errors.emergencyContact && (
              <p className="text-[var(--sds-danger)] text-sm mt-1 text-right">{errors.emergencyContact}</p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4 space-x-reverse pt-4">
          <ErpPressable
            type="button"
            onClick={onCancel}
            className="px-6 py-3"
            disabled={loading}
          >
            انصراف
          </ErpPressable>
          <ErpPressable
            type="submit"
            tone="primary"
            variant="solid"
            className="px-6 py-3"
            disabled={loading}
          >
            {loading ? 'در حال ذخیره...' : initialData ? 'ذخیره تغییرات' : 'ثبت استثنا'}
          </ErpPressable>
        </div>
      </form>
    </div>
  );
}


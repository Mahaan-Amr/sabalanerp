'use client';

import { useState, useEffect } from 'react';
import { FaMapMarkerAlt, FaUser, FaCalendarAlt, FaClock, FaFileAlt } from 'react-icons/fa';
import PersianCalendarComponent from './PersianCalendar';
import EnhancedDropdown from './EnhancedDropdown';
import { personnelAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

interface MissionAssignmentFormProps {
  onSubmit: (data: any) => void;
  onCancel: () => void;
  loading?: boolean;
  initialData?: any;
}

const missionTypes = [
  { value: 'داخل شهری', label: 'داخل شهری' },
  { value: 'خارج شهری', label: 'خارج شهری' }
];

export default function MissionAssignmentForm({ onSubmit, onCancel, loading = false, initialData }: MissionAssignmentFormProps) {
  const [formData, setFormData] = useState({
    personnelId: initialData?.personnelId || '',
    missionType: initialData?.missionType || '',
    missionLocation: initialData?.missionLocation || '',
    missionPurpose: initialData?.missionPurpose || '',
    startDate: initialData?.startDate || '',
    endDate: initialData?.endDate || '',
    startTime: initialData?.startTime || '',
    endTime: initialData?.endTime || '',
    notes: initialData?.notes || ''
  });

  const [employees, setEmployees] = useState<any[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const response = await personnelAPI.getPersonnel({ includeInactive: false });
      setEmployees(response.data.data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.personnelId) newErrors.personnelId = 'انتخاب پرسنل الزامی است';
    if (!formData.missionType) newErrors.missionType = 'نوع ماموریت الزامی است';
    if (!formData.missionLocation) newErrors.missionLocation = 'محل ماموریت الزامی است';
    if (!formData.missionPurpose) newErrors.missionPurpose = 'هدف ماموریت الزامی است';
    if (!formData.startDate) newErrors.startDate = 'تاریخ شروع الزامی است';
    if (!formData.startTime) newErrors.startTime = 'زمان شروع الزامی است';
    if (!formData.endTime) newErrors.endTime = 'زمان پایان الزامی است';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit({ ...formData, startDate: PersianCalendar.toGregorianDateOnly(formData.startDate), endDate: formData.endDate ? PersianCalendar.toGregorianDateOnly(formData.endDate) : undefined });
    }
  };

  return (
    <div className="glass-liquid-card p-6">
      <h2 className="text-2xl font-bold text-primary mb-6 text-right">{initialData ? 'ویرایش ماموریت' : 'ثبت ماموریت'}</h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Employee Selection */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            کارمند *
          </label>
          <EnhancedDropdown
            value={formData.personnelId}
            onChange={(value) => handleInputChange('personnelId', value)}
            placeholder="انتخاب کارمند"
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.firstName} ${employee.lastName} (${employee.department?.namePersian || 'نامشخص'})`,
            }))}
            searchable
            required
            error={errors.personnelId}
            noOptionsText="کارمندی پیدا نشد"
          />
          {errors.personnelId && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.personnelId}</p>
          )}
        </div>

        {/* Mission Type */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            نوع ماموریت *
          </label>
          <EnhancedDropdown
            value={formData.missionType}
            onChange={(value) => handleInputChange('missionType', value)}
            placeholder="انتخاب نوع ماموریت"
            options={missionTypes}
            searchable
            required
            error={errors.missionType}
          />
          {errors.missionType && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.missionType}</p>
          )}
        </div>

        {/* Mission Location */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            محل ماموریت *
          </label>
          <input
            type="text"
            value={formData.missionLocation}
            onChange={(e) => handleInputChange('missionLocation', e.target.value)}
            className={`glass-liquid-input w-full ${errors.missionLocation ? 'border-red-500' : ''}`}
            placeholder="محل ماموریت را وارد کنید"
          />
          {errors.missionLocation && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.missionLocation}</p>
          )}
        </div>

        {/* Mission Purpose */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            هدف ماموریت *
          </label>
          <textarea
            value={formData.missionPurpose}
            onChange={(e) => handleInputChange('missionPurpose', e.target.value)}
            className={`glass-liquid-input w-full h-24 resize-none ${errors.missionPurpose ? 'border-red-500' : ''}`}
            placeholder="هدف و شرح ماموریت را وارد کنید"
          />
          {errors.missionPurpose && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.missionPurpose}</p>
          )}
        </div>

        {/* Date Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-primary mb-2 text-right">
              تاریخ شروع *
            </label>
            <PersianCalendarComponent
              value={formData.startDate}
              onChange={(date) => handleInputChange('startDate', date)}
              placeholder="انتخاب تاریخ شروع"
              className={errors.startDate ? 'border-red-500' : ''}
              disablePastDates
            />
            {errors.startDate && (
              <p className="text-red-500 text-sm mt-1 text-right">{errors.startDate}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-primary mb-2 text-right">
              تاریخ پایان
            </label>
            <PersianCalendarComponent
              value={formData.endDate}
              onChange={(date) => handleInputChange('endDate', date)}
              placeholder="انتخاب تاریخ پایان (اختیاری)"
              disablePastDates
            />
          </div>
        </div>

        {/* Time Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-primary mb-2 text-right">
              زمان شروع *
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
              زمان پایان *
            </label>
            <input
              type="time"
              value={formData.endTime}
              onChange={(e) => handleInputChange('endTime', e.target.value)}
              className={`glass-liquid-input w-full ${errors.endTime ? 'border-red-500' : ''}`}
            />
            {errors.endTime && <p className="text-red-500 text-sm mt-1 text-right">{errors.endTime}</p>}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            توضیحات
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            className="glass-liquid-input w-full h-20 resize-none"
            placeholder="توضیحات اضافی (اختیاری)"
          />
        </div>

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
            {loading ? 'در حال ذخیره...' : initialData ? 'ذخیره تغییرات' : 'ثبت ماموریت'}
          </button>
        </div>
      </form>
    </div>
  );
}


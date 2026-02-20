'use client';

import { useState, useEffect } from 'react';
import { FaMapMarkerAlt, FaUser, FaCalendarAlt, FaClock, FaFileAlt } from 'react-icons/fa';
import PersianCalendarComponent from './PersianCalendar';

interface MissionAssignmentFormProps {
  onSubmit: (data: any) => void;
  onCancel: () => void;
  loading?: boolean;
}

const missionTypes = [
  { value: '?? ???', label: '?? ???' },
  { value: '?? ???', label: '?? ???' }
];

export default function MissionAssignmentForm({ onSubmit, onCancel, loading = false }: MissionAssignmentFormProps) {
  const [formData, setFormData] = useState({
    employeeId: '',
    missionType: '',
    missionLocation: '',
    missionPurpose: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    notes: ''
  });

  const [employees, setEmployees] = useState<any[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.data || []);
      }
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

    if (!formData.employeeId) newErrors.employeeId = '??? ??? ??? ??';
    if (!formData.missionType) newErrors.missionType = '?? ?? ??? ??';
    if (!formData.missionLocation) newErrors.missionLocation = '?? ?? ??? ??';
    if (!formData.missionPurpose) newErrors.missionPurpose = '?? ?? ??? ??';
    if (!formData.startDate) newErrors.startDate = '??? ?? ??? ??';
    if (!formData.startTime) newErrors.startTime = '?? ?? ??? ??';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(formData);
    }
  };

  return (
    <div className="glass-liquid-card p-6">
      <h2 className="text-2xl font-bold text-primary mb-6 text-right">??? ??</h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Employee Selection */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            ??? *
          </label>
          <select
            value={formData.employeeId}
            onChange={(e) => handleInputChange('employeeId', e.target.value)}
            className={`glass-liquid-input w-full ${errors.employeeId ? 'border-red-500' : ''}`}
          >
            <option value="">??? ???</option>
            {employees.map(employee => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName} ({employee.department?.namePersian || '???'})
              </option>
            ))}
          </select>
          {errors.employeeId && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.employeeId}</p>
          )}
        </div>

        {/* Mission Type */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            ?? ?? *
          </label>
          <select
            value={formData.missionType}
            onChange={(e) => handleInputChange('missionType', e.target.value)}
            className={`glass-liquid-input w-full ${errors.missionType ? 'border-red-500' : ''}`}
          >
            <option value="">??? ?? ??</option>
            {missionTypes.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          {errors.missionType && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.missionType}</p>
          )}
        </div>

        {/* Mission Location */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            ?? ?? *
          </label>
          <input
            type="text"
            value={formData.missionLocation}
            onChange={(e) => handleInputChange('missionLocation', e.target.value)}
            className={`glass-liquid-input w-full ${errors.missionLocation ? 'border-red-500' : ''}`}
            placeholder="?? ??? ??"
          />
          {errors.missionLocation && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.missionLocation}</p>
          )}
        </div>

        {/* Mission Purpose */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            ?? ?? *
          </label>
          <textarea
            value={formData.missionPurpose}
            onChange={(e) => handleInputChange('missionPurpose', e.target.value)}
            className={`glass-liquid-input w-full h-24 resize-none ${errors.missionPurpose ? 'border-red-500' : ''}`}
            placeholder="?? ? ?? ?? ? ??? ??"
          />
          {errors.missionPurpose && (
            <p className="text-red-500 text-sm mt-1 text-right">{errors.missionPurpose}</p>
          )}
        </div>

        {/* Date Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-primary mb-2 text-right">
              ??? ?? *
            </label>
            <PersianCalendarComponent
              value={formData.startDate}
              onChange={(date) => handleInputChange('startDate', date)}
              placeholder="??? ??? ??"
              className={errors.startDate ? 'border-red-500' : ''}
            />
            {errors.startDate && (
              <p className="text-red-500 text-sm mt-1 text-right">{errors.startDate}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-primary mb-2 text-right">
              ??? ???
            </label>
            <PersianCalendarComponent
              value={formData.endDate}
              onChange={(date) => handleInputChange('endDate', date)}
              placeholder="??? ??? ??? (??)"
            />
          </div>
        </div>

        {/* Time Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-primary mb-2 text-right">
              ?? ?? *
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
              ?? ???
            </label>
            <input
              type="time"
              value={formData.endTime}
              onChange={(e) => handleInputChange('endTime', e.target.value)}
              className="glass-liquid-input w-full"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-primary mb-2 text-right">
            ???
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            className="glass-liquid-input w-full h-20 resize-none"
            placeholder="?? ??? (??)"
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
            ???
          </button>
          <button
            type="submit"
            className="glass-liquid-btn-primary px-6 py-3"
            disabled={loading}
          >
            {loading ? '? ?? ???...' : '??? ??'}
          </button>
        </div>
      </form>
    </div>
  );
}


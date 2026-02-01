'use client';

import { useState, useEffect } from 'react';
import { 
  FaShieldAlt, 
  FaPlus, 
  FaEdit, 
  FaTrash, 
  FaUser,
  FaClock,
  FaCheckCircle,
  FaTimesCircle
} from 'react-icons/fa';
import { securityAPI } from '@/lib/api';

interface SecurityPersonnel {
  id: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    role: string;
    department?: {
      name: string;
      namePersian: string;
    };
  };
  shift: {
    id: string;
    name: string;
    namePersian: string;
    startTime: string;
    endTime: string;
  };
  isActive: boolean;
  assignedAt: string;
  lastActivity?: string;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: string;
  department?: {
    name: string;
    namePersian: string;
  };
}

interface Shift {
  id: string;
  name: string;
  namePersian: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export default function PersonnelPage() {
  const [personnel, setPersonnel] = useState<SecurityPersonnel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignFormData, setAssignFormData] = useState({
    userId: '',
    shiftId: ''
  });

  useEffect(() => {
    fetchPersonnelData();
  }, []);

  const fetchPersonnelData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [personnelResponse, shiftsResponse] = await Promise.all([
        securityAPI.getPersonnel(),
        securityAPI.getShifts()
      ]);
      
      if (personnelResponse.data.success) {
        setPersonnel(personnelResponse.data.data);
      }
      
      if (shiftsResponse.data.success) {
        setShifts(shiftsResponse.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching personnel data:', error);
      setError(error.response?.data?.error || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignPersonnel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await securityAPI.assignPersonnel(assignFormData);
      if (response.data.success) {
        setShowAssignForm(false);
        setAssignFormData({ userId: '', shiftId: '' });
        fetchPersonnelData();
        alert('پرسنل با موفقیت تخصیص یافت');
      }
    } catch (error: any) {
      console.error('Error assigning personnel:', error);
      alert(error.response?.data?.error || 'خطا در تخصیص پرسنل');
    }
  };

  const handleToggleActive = async (personnelId: string, isActive: boolean) => {
    try {
      // This would need a new API endpoint
      // const response = await securityAPI.togglePersonnelStatus(personnelId, !isActive);
      alert('این قابلیت در حال توسعه است');
    } catch (error: any) {
      console.error('Error toggling personnel status:', error);
      alert(error.response?.data?.error || 'خطا در تغییر وضعیت پرسنل');
    }
  };

  const formatTime = (time: string) => {
    return new Date(`2000-01-01T${time}`).toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="glass-liquid-card p-8 text-center">
          <h2 className="text-xl font-bold text-primary mb-2">خطا در بارگذاری</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchPersonnelData}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            تلاش مجدد
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaShieldAlt className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">پرسنل امنیت</h1>
              <p className="text-secondary">مدیریت پرسنل امنیت و تخصیص شیفت‌ها</p>
            </div>
          </div>
          <button
            onClick={() => setShowAssignForm(true)}
            className="glass-liquid-btn-primary px-4 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaPlus />
            <span>تخصیص پرسنل</span>
          </button>
        </div>
      </div>

      {/* Personnel Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-liquid-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">کل پرسنل</p>
              <p className="text-xl font-bold text-primary">{personnel.length}</p>
            </div>
            <FaUser className="h-6 w-6 text-blue-500" />
          </div>
        </div>
        <div className="glass-liquid-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">فعال</p>
              <p className="text-xl font-bold text-green-500">
                {personnel.filter(p => p.isActive).length}
              </p>
            </div>
            <FaCheckCircle className="h-6 w-6 text-green-500" />
          </div>
        </div>
        <div className="glass-liquid-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">غیرفعال</p>
              <p className="text-xl font-bold text-red-500">
                {personnel.filter(p => !p.isActive).length}
              </p>
            </div>
            <FaTimesCircle className="h-6 w-6 text-red-500" />
          </div>
        </div>
        <div className="glass-liquid-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">شیفت‌های فعال</p>
              <p className="text-xl font-bold text-teal-500">
                {shifts.filter(s => s.isActive).length}
              </p>
            </div>
            <FaClock className="h-6 w-6 text-teal-500" />
          </div>
        </div>
      </div>

      {/* Personnel Table */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-bold text-primary mb-4">لیست پرسنل امنیت</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">نام پرسنل</th>
                <th className="text-right py-3 px-4 text-secondary">بخش</th>
                <th className="text-right py-3 px-4 text-secondary">شیفت</th>
                <th className="text-right py-3 px-4 text-secondary">ساعات کاری</th>
                <th className="text-right py-3 px-4 text-secondary">وضعیت</th>
                <th className="text-right py-3 px-4 text-secondary">تاریخ تخصیص</th>
                <th className="text-right py-3 px-4 text-secondary">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {personnel.map((person) => (
                <tr key={person.id} className="border-b border-gray-800 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <div>
                      <div className="font-medium text-primary">
                        {person.user.firstName} {person.user.lastName}
                      </div>
                      <div className="text-sm text-secondary">
                        @{person.user.username}
                      </div>
                      <div className="text-xs text-gray-500">
                        {person.user.email}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-secondary">
                    {person.user.department?.namePersian || '-'}
                  </td>
                  <td className="py-3 px-4">
                    <div>
                      <div className="text-primary font-medium">
                        {person.shift.namePersian}
                      </div>
                      <div className="text-sm text-secondary">
                        {person.shift.name}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-secondary">
                    <div className="text-sm">
                      <div>{formatTime(person.shift.startTime)} - {formatTime(person.shift.endTime)}</div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleToggleActive(person.id, person.isActive)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        person.isActive 
                          ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30' 
                          : 'bg-gray-500/20 text-gray-500 hover:bg-gray-500/30'
                      }`}
                    >
                      {person.isActive ? 'فعال' : 'غیرفعال'}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-secondary">
                    {new Date(person.assignedAt).toLocaleDateString('fa-IR')}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex space-x-2 space-x-reverse">
                      <button className="glass-liquid-btn p-2">
                        <FaEdit />
                      </button>
                      <button className="glass-liquid-btn p-2 text-red-400">
                        <FaTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {personnel.length === 0 && (
          <div className="text-center py-8">
            <p className="text-secondary">هیچ پرسنل امنیتی تخصیص نیافته است</p>
          </div>
        )}
      </div>

      {/* Assign Personnel Modal */}
      {showAssignForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-liquid-card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-primary mb-4">تخصیص پرسنل به شیفت</h2>
            <form onSubmit={handleAssignPersonnel} className="space-y-4">
              <div>
                <label className="block text-sm text-secondary mb-2">انتخاب کاربر</label>
                <select
                  value={assignFormData.userId}
                  onChange={(e) => setAssignFormData({ ...assignFormData, userId: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                >
                  <option value="">کاربر را انتخاب کنید</option>
                  {/* This would need to fetch available users */}
                  <option value="user1">کاربر نمونه ۱</option>
                  <option value="user2">کاربر نمونه ۲</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-secondary mb-2">انتخاب شیفت</label>
                <select
                  value={assignFormData.shiftId}
                  onChange={(e) => setAssignFormData({ ...assignFormData, shiftId: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                >
                  <option value="">شیفت را انتخاب کنید</option>
                  {shifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.namePersian} ({formatTime(shift.startTime)} - {formatTime(shift.endTime)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex space-x-4 space-x-reverse">
                <button
                  type="submit"
                  className="flex-1 glass-liquid-btn-primary px-4 py-2"
                >
                  تخصیص پرسنل
                </button>
                <button
                  type="button"
                  onClick={() => setShowAssignForm(false)}
                  className="flex-1 glass-liquid-btn px-4 py-2"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

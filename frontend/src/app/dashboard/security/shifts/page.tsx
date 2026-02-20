'use client';

import { useState, useEffect } from 'react';
import { 
  FaClock, 
  FaPlus, 
  FaEdit, 
  FaTrash, 
  FaPlay, 
  FaStop,
  FaUsers,
  FaCalendarAlt
} from 'react-icons/fa';
import { securityAPI } from '@/lib/api';

interface Shift {
  id: string;
  name: string;
  namePersian: string;
  startTime: string;
  endTime: string;
  duration: number;
  isActive: boolean;
  _count: {
    securityPersonnel: number;
    attendanceRecords: number;
  };
}

interface SecurityPersonnel {
  id: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  shift: {
    id: string;
    name: string;
    namePersian: string;
  };
  isActive: boolean;
  assignedAt: string;
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [personnel, setPersonnel] = useState<SecurityPersonnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    namePersian: '',
    startTime: '',
    endTime: '',
    duration: 12
  });

  useEffect(() => {
    fetchShiftsData();
  }, []);

  const fetchShiftsData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [shiftsResponse, personnelResponse] = await Promise.all([
        securityAPI.getShifts(),
        securityAPI.getPersonnel()
      ]);
      
      if (shiftsResponse.data.success) {
        setShifts(shiftsResponse.data.data);
      }
      
      if (personnelResponse.data.success) {
        setPersonnel(personnelResponse.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching shifts data:', error);
      setError(error.response?.data?.error || '?? ? ??? ? ??');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await securityAPI.createShift(formData);
      if (response.data.success) {
        setShowCreateForm(false);
        setFormData({ name: '', namePersian: '', startTime: '', endTime: '', duration: 12 });
        fetchShiftsData();
      }
    } catch (error: any) {
      console.error('Error creating shift:', error);
      alert(error.response?.data?.error || '?? ? ??? ??');
    }
  };

  const handleStartShift = async (shiftId: string) => {
    try {
      const response = await securityAPI.startShift(shiftId);
      if (response.data.success) {
        alert('?? ? ??? ?? ?');
        fetchShiftsData();
      }
    } catch (error: any) {
      console.error('Error starting shift:', error);
      alert(error.response?.data?.error || '?? ? ?? ??');
    }
  };

  const handleEndShift = async () => {
    try {
      const response = await securityAPI.endShift();
      if (response.data.success) {
        alert('?? ? ??? ??? ??');
        fetchShiftsData();
      }
    } catch (error: any) {
      console.error('Error ending shift:', error);
      alert(error.response?.data?.error || '?? ? ??? ??');
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
          <h2 className="text-xl font-bold text-primary mb-2">?? ? ??</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchShiftsData}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            ?? ??
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
            <FaClock className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">??? ??</h1>
              <p className="text-secondary">??? ?? ??? ? ???</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="glass-liquid-btn-primary px-4 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaPlus />
            <span>?? ??</span>
          </button>
        </div>
      </div>

      {/* Shifts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {shifts.map((shift) => (
          <div key={shift.id} className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-primary">{shift.namePersian}</h3>
                <p className="text-sm text-secondary">{shift.name}</p>
              </div>
              <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                shift.isActive 
                  ? 'bg-green-500/20 text-green-500' 
                  : 'bg-gray-500/20 text-gray-500'
              }`}>
                {shift.isActive ? '??' : '??'}
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-secondary">?? ??:</span>
                <span className="text-primary">{formatTime(shift.startTime)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-secondary">?? ???:</span>
                <span className="text-primary">{formatTime(shift.endTime)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-secondary">?? ??:</span>
                <span className="text-primary">{shift.duration} ??</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-secondary">???:</span>
                <span className="text-primary">{shift._count.securityPersonnel} ??</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-secondary">??:</span>
                <span className="text-primary">{shift._count.attendanceRecords} ???</span>
              </div>
            </div>

            <div className="flex space-x-2 space-x-reverse">
              {shift.isActive ? (
                <button
                  onClick={handleEndShift}
                  className="flex-1 glass-liquid-btn flex items-center justify-center space-x-2 space-x-reverse"
                >
                  <FaStop />
                  <span>??? ??</span>
                </button>
              ) : (
                <button
                  onClick={() => handleStartShift(shift.id)}
                  className="flex-1 glass-liquid-btn-primary flex items-center justify-center space-x-2 space-x-reverse"
                >
                  <FaPlay />
                  <span>?? ??</span>
                </button>
              )}
              <button
                onClick={() => setEditingShift(shift)}
                className="glass-liquid-btn p-2"
              >
                <FaEdit />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Personnel Assignment */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-bold text-primary mb-4">??? ??? ? ??</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">?? ???</th>
                <th className="text-right py-3 px-4 text-secondary">?? ??</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
                <th className="text-right py-3 px-4 text-secondary">??? ???</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
              </tr>
            </thead>
            <tbody>
              {personnel.map((person) => (
                <tr key={person.id} className="border-b border-gray-800">
                  <td className="py-3 px-4">
                    <div>
                      <div className="font-medium text-primary">
                        {person.user.firstName} {person.user.lastName}
                      </div>
                      <div className="text-sm text-secondary">
                        @{person.user.username}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-primary">
                    {person.shift.namePersian}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      person.isActive 
                        ? 'bg-green-500/20 text-green-500' 
                        : 'bg-gray-500/20 text-gray-500'
                    }`}>
                      {person.isActive ? '??' : '??'}
                    </span>
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
      </div>

      {/* Create Shift Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-liquid-card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-primary mb-4">??? ?? ??</h2>
            <form onSubmit={handleCreateShift} className="space-y-4">
              <div>
                <label className="block text-sm text-secondary mb-2">?? ??</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-2">?? ???</label>
                <input
                  type="text"
                  value={formData.namePersian}
                  onChange={(e) => setFormData({ ...formData, namePersian: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-2">?? ??</label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-2">?? ???</label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-2">?? ?? (??)</label>
                <input
                  type="number"
                  value={formData.duration}
                  onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) })}
                  className="glass-liquid-input w-full"
                  min="1"
                  max="24"
                  required
                />
              </div>
              <div className="flex space-x-4 space-x-reverse">
                <button
                  type="submit"
                  className="flex-1 glass-liquid-btn-primary px-4 py-2"
                >
                  ??? ??
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 glass-liquid-btn px-4 py-2"
                >
                  ???
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


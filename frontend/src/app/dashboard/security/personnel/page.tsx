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
      setError(error.response?.data?.error || '?? ? ??? ? ??');
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
        alert('??? ? ??? ??? ??');
      }
    } catch (error: any) {
      console.error('Error assigning personnel:', error);
      alert(error.response?.data?.error || '?? ? ??? ???');
    }
  };

  const handleToggleActive = async (personnelId: string, isActive: boolean) => {
    try {
      // This would need a new API endpoint
      // const response = await securityAPI.togglePersonnelStatus(personnelId, !isActive);
      alert('?? ??? ? ?? ??? ??');
    } catch (error: any) {
      console.error('Error toggling personnel status:', error);
      alert(error.response?.data?.error || '?? ? ??? ??? ???');
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
            onClick={fetchPersonnelData}
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
            <FaShieldAlt className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">??? ???</h1>
              <p className="text-secondary">??? ??? ??? ? ??? ??</p>
            </div>
          </div>
          <button
            onClick={() => setShowAssignForm(true)}
            className="glass-liquid-btn-primary px-4 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaPlus />
            <span>??? ???</span>
          </button>
        </div>
      </div>

      {/* Personnel Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-liquid-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">? ???</p>
              <p className="text-xl font-bold text-primary">{personnel.length}</p>
            </div>
            <FaUser className="h-6 w-6 text-blue-500" />
          </div>
        </div>
        <div className="glass-liquid-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-secondary">??</p>
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
              <p className="text-sm text-secondary">??</p>
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
              <p className="text-sm text-secondary">?? ??</p>
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
        <h2 className="text-xl font-bold text-primary mb-4">?? ??? ???</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">?? ???</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
                <th className="text-right py-3 px-4 text-secondary">??? ??</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
                <th className="text-right py-3 px-4 text-secondary">??? ???</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
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
                      {person.isActive ? '??' : '??'}
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
            <p className="text-secondary">?? ??? ??? ??? ??? ??</p>
          </div>
        )}
      </div>

      {/* Assign Personnel Modal */}
      {showAssignForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-liquid-card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-primary mb-4">??? ??? ? ??</h2>
            <form onSubmit={handleAssignPersonnel} className="space-y-4">
              <div>
                <label className="block text-sm text-secondary mb-2">??? ???</label>
                <select
                  value={assignFormData.userId}
                  onChange={(e) => setAssignFormData({ ...assignFormData, userId: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                >
                  <option value="">??? ? ??? ??</option>
                  {/* This would need to fetch available users */}
                  <option value="user1">??? ??? ?</option>
                  <option value="user2">??? ??? ?</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-secondary mb-2">??? ??</label>
                <select
                  value={assignFormData.shiftId}
                  onChange={(e) => setAssignFormData({ ...assignFormData, shiftId: e.target.value })}
                  className="glass-liquid-input w-full"
                  required
                >
                  <option value="">?? ? ??? ??</option>
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
                  ??? ???
                </button>
                <button
                  type="button"
                  onClick={() => setShowAssignForm(false)}
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


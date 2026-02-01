'use client';

import { useState, useEffect } from 'react';
import { 
  FaExclamationTriangle, 
  FaPlus, 
  FaCheck, 
  FaTimes, 
  FaClock,
  FaUser,
  FaCalendarAlt,
  FaEye
} from 'react-icons/fa';
import { securityAPI } from '@/lib/api';

interface ExceptionRequest {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  exceptionType: string;
  reason: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  status: string;
  notes?: string;
  approvedBy?: {
    firstName: string;
    lastName: string;
  };
  rejectedBy?: {
    firstName: string;
    lastName: string;
  };
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface MissionAssignment {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  missionType: string;
  missionLocation: string;
  description: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  status: string;
  approvedBy?: {
    firstName: string;
    lastName: string;
  };
  createdAt: string;
  updatedAt: string;
}

export default function ExceptionsPage() {
  const [exceptionRequests, setExceptionRequests] = useState<ExceptionRequest[]>([]);
  const [missionAssignments, setMissionAssignments] = useState<MissionAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'exceptions' | 'missions'>('exceptions');
  const [selectedRequest, setSelectedRequest] = useState<ExceptionRequest | null>(null);
  const [selectedMission, setSelectedMission] = useState<MissionAssignment | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  useEffect(() => {
    fetchExceptionsData();
  }, []);

  const fetchExceptionsData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [exceptionsResponse, missionsResponse] = await Promise.all([
        securityAPI.getExceptionRequests({ limit: 50 }),
        securityAPI.getMissionAssignments({ limit: 50 })
      ]);
      
      if (exceptionsResponse.data.success) {
        setExceptionRequests(exceptionsResponse.data.data);
      }
      
      if (missionsResponse.data.success) {
        setMissionAssignments(missionsResponse.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching exceptions data:', error);
      setError(error.response?.data?.error || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveException = async (id: string, notes?: string) => {
    try {
      const response = await securityAPI.approveExceptionRequest(id, notes);
      if (response.data.success) {
        alert('درخواست استثنا با موفقیت تایید شد');
        fetchExceptionsData();
      }
    } catch (error: any) {
      console.error('Error approving exception:', error);
      alert(error.response?.data?.error || 'خطا در تایید درخواست');
    }
  };

  const handleRejectException = async (id: string, rejectionReason: string) => {
    try {
      const response = await securityAPI.rejectExceptionRequest(id, rejectionReason);
      if (response.data.success) {
        alert('درخواست استثنا رد شد');
        fetchExceptionsData();
      }
    } catch (error: any) {
      console.error('Error rejecting exception:', error);
      alert(error.response?.data?.error || 'خطا در رد درخواست');
    }
  };

  const handleApproveMission = async (id: string) => {
    try {
      const response = await securityAPI.approveMissionAssignment(id);
      if (response.data.success) {
        alert('ماموریت با موفقیت تایید شد');
        fetchExceptionsData();
      }
    } catch (error: any) {
      console.error('Error approving mission:', error);
      alert(error.response?.data?.error || 'خطا در تایید ماموریت');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'text-yellow-500 bg-yellow-500/20';
      case 'APPROVED': return 'text-green-500 bg-green-500/20';
      case 'REJECTED': return 'text-red-500 bg-red-500/20';
      default: return 'text-gray-500 bg-gray-500/20';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'PENDING': return 'در انتظار';
      case 'APPROVED': return 'تایید شده';
      case 'REJECTED': return 'رد شده';
      default: return 'نامشخص';
    }
  };

  const getExceptionTypeLabel = (type: string) => {
    switch (type) {
      case 'HOURLY_LEAVE': return 'مرخصی ساعتی';
      case 'SICK_LEAVE': return 'مرخصی استعلاجی';
      case 'VACATION': return 'مرخصی استحقاقی';
      case 'EMERGENCY': return 'اضطراری';
      default: return type;
    }
  };

  const openDetailsModal = (item: ExceptionRequest | MissionAssignment, type: 'exception' | 'mission') => {
    if (type === 'exception') {
      setSelectedRequest(item as ExceptionRequest);
    } else {
      setSelectedMission(item as MissionAssignment);
    }
    setShowDetailsModal(true);
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
            onClick={fetchExceptionsData}
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
            <FaExclamationTriangle className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">مدیریت استثنائات</h1>
              <p className="text-secondary">درخواست‌های استثنا و ماموریت‌ها</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="glass-liquid-card p-6">
        <div className="flex space-x-4 space-x-reverse border-b border-gray-700">
          <button
            onClick={() => setActiveTab('exceptions')}
            className={`pb-3 px-4 font-medium transition-colors ${
              activeTab === 'exceptions'
                ? 'text-teal-400 border-b-2 border-teal-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            درخواست‌های استثنا ({exceptionRequests.length})
          </button>
          <button
            onClick={() => setActiveTab('missions')}
            className={`pb-3 px-4 font-medium transition-colors ${
              activeTab === 'missions'
                ? 'text-teal-400 border-b-2 border-teal-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            ماموریت‌ها ({missionAssignments.length})
          </button>
        </div>
      </div>

      {/* Exception Requests */}
      {activeTab === 'exceptions' && (
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">درخواست‌های استثنا</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-right py-3 px-4 text-secondary">کارمند</th>
                  <th className="text-right py-3 px-4 text-secondary">نوع استثنا</th>
                  <th className="text-right py-3 px-4 text-secondary">دلیل</th>
                  <th className="text-right py-3 px-4 text-secondary">تاریخ</th>
                  <th className="text-right py-3 px-4 text-secondary">وضعیت</th>
                  <th className="text-right py-3 px-4 text-secondary">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {exceptionRequests.map((request) => (
                  <tr key={request.id} className="border-b border-gray-800 hover:bg-white/5">
                    <td className="py-3 px-4">
                      <div>
                        <div className="font-medium text-primary">
                          {request.employee.firstName} {request.employee.lastName}
                        </div>
                        <div className="text-sm text-secondary">
                          @{request.employee.username}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-primary">
                      {getExceptionTypeLabel(request.exceptionType)}
                    </td>
                    <td className="py-3 px-4 text-secondary">
                      <div className="max-w-xs truncate">
                        {request.reason}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-secondary">
                      <div className="text-sm">
                        <div>{new Date(request.startDate).toLocaleDateString('fa-IR')}</div>
                        {request.endDate !== request.startDate && (
                          <div>تا {new Date(request.endDate).toLocaleDateString('fa-IR')}</div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(request.status)}`}>
                        {getStatusLabel(request.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex space-x-2 space-x-reverse">
                        <button
                          onClick={() => openDetailsModal(request, 'exception')}
                          className="glass-liquid-btn p-2"
                          title="مشاهده جزئیات"
                        >
                          <FaEye />
                        </button>
                        {request.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => handleApproveException(request.id)}
                              className="glass-liquid-btn p-2 text-green-400"
                              title="تایید"
                            >
                              <FaCheck />
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt('دلیل رد درخواست:');
                                if (reason) handleRejectException(request.id, reason);
                              }}
                              className="glass-liquid-btn p-2 text-red-400"
                              title="رد"
                            >
                              <FaTimes />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {exceptionRequests.length === 0 && (
            <div className="text-center py-8">
              <p className="text-secondary">هیچ درخواست استثنایی وجود ندارد</p>
            </div>
          )}
        </div>
      )}

      {/* Mission Assignments */}
      {activeTab === 'missions' && (
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">ماموریت‌ها</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-right py-3 px-4 text-secondary">کارمند</th>
                  <th className="text-right py-3 px-4 text-secondary">نوع ماموریت</th>
                  <th className="text-right py-3 px-4 text-secondary">مکان</th>
                  <th className="text-right py-3 px-4 text-secondary">تاریخ</th>
                  <th className="text-right py-3 px-4 text-secondary">وضعیت</th>
                  <th className="text-right py-3 px-4 text-secondary">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {missionAssignments.map((mission) => (
                  <tr key={mission.id} className="border-b border-gray-800 hover:bg-white/5">
                    <td className="py-3 px-4">
                      <div>
                        <div className="font-medium text-primary">
                          {mission.employee.firstName} {mission.employee.lastName}
                        </div>
                        <div className="text-sm text-secondary">
                          @{mission.employee.username}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-primary">
                      {mission.missionType}
                    </td>
                    <td className="py-3 px-4 text-secondary">
                      <div className="max-w-xs truncate">
                        {mission.missionLocation}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-secondary">
                      <div className="text-sm">
                        <div>{new Date(mission.startDate).toLocaleDateString('fa-IR')}</div>
                        <div>{mission.startTime} - {mission.endTime}</div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(mission.status)}`}>
                        {getStatusLabel(mission.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex space-x-2 space-x-reverse">
                        <button
                          onClick={() => openDetailsModal(mission, 'mission')}
                          className="glass-liquid-btn p-2"
                          title="مشاهده جزئیات"
                        >
                          <FaEye />
                        </button>
                        {mission.status === 'PENDING' && (
                          <button
                            onClick={() => handleApproveMission(mission.id)}
                            className="glass-liquid-btn p-2 text-green-400"
                            title="تایید"
                          >
                            <FaCheck />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {missionAssignments.length === 0 && (
            <div className="text-center py-8">
              <p className="text-secondary">هیچ ماموریتی تعیین نشده است</p>
            </div>
          )}
        </div>
      )}

      {/* Details Modal */}
      {showDetailsModal && (selectedRequest || selectedMission) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-liquid-card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-primary">جزئیات</h2>
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedRequest(null);
                  setSelectedMission(null);
                }}
                className="glass-liquid-btn p-2"
              >
                <FaTimes />
              </button>
            </div>
            
            {selectedRequest && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-secondary mb-1">کارمند</label>
                    <p className="text-primary">
                      {selectedRequest.employee.firstName} {selectedRequest.employee.lastName}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">نوع استثنا</label>
                    <p className="text-primary">{getExceptionTypeLabel(selectedRequest.exceptionType)}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">دلیل</label>
                    <p className="text-primary">{selectedRequest.reason}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">وضعیت</label>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(selectedRequest.status)}`}>
                      {getStatusLabel(selectedRequest.status)}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">تاریخ شروع</label>
                    <p className="text-primary">{new Date(selectedRequest.startDate).toLocaleDateString('fa-IR')}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">تاریخ پایان</label>
                    <p className="text-primary">{new Date(selectedRequest.endDate).toLocaleDateString('fa-IR')}</p>
                  </div>
                </div>
                {selectedRequest.notes && (
                  <div>
                    <label className="block text-sm text-secondary mb-1">یادداشت‌ها</label>
                    <p className="text-primary">{selectedRequest.notes}</p>
                  </div>
                )}
              </div>
            )}
            
            {selectedMission && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-secondary mb-1">کارمند</label>
                    <p className="text-primary">
                      {selectedMission.employee.firstName} {selectedMission.employee.lastName}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">نوع ماموریت</label>
                    <p className="text-primary">{selectedMission.missionType}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">مکان</label>
                    <p className="text-primary">{selectedMission.missionLocation}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">وضعیت</label>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(selectedMission.status)}`}>
                      {getStatusLabel(selectedMission.status)}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">تاریخ</label>
                    <p className="text-primary">{new Date(selectedMission.startDate).toLocaleDateString('fa-IR')}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">ساعت</label>
                    <p className="text-primary">{selectedMission.startTime} - {selectedMission.endTime}</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-secondary mb-1">توضیحات</label>
                  <p className="text-primary">{selectedMission.description}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

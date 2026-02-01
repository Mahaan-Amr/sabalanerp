'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FaFileContract, 
  FaPlus,
  FaEye,
  FaEdit,
  FaCheck,
  FaSignature,
  FaPrint,
  FaClock,
  FaExclamationTriangle,
  FaSearch,
  FaFilter,
  FaTimes
} from 'react-icons/fa';
import { salesAPI, dashboardAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import PersianCalendar from '@/lib/persian-calendar';
import { getContractPermissions, User } from '@/lib/permissions';

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  titlePersian: string;
  status: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    customerType?: string;
    status?: string;
    nationalCode?: string;
    projectManagerName?: string;
  };
}

const statusColors = {
  DRAFT: 'text-gray-500 bg-gray-500/20',
  PENDING_APPROVAL: 'text-yellow-500 bg-yellow-500/20',
  APPROVED: 'text-blue-500 bg-blue-500/20',
  SIGNED: 'text-green-500 bg-green-500/20',
  PRINTED: 'text-purple-500 bg-purple-500/20',
  CANCELLED: 'text-red-500 bg-red-500/20',
  EXPIRED: 'text-gray-400 bg-gray-400/20'
};

const statusLabels = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده'
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'DRAFT':
      return <FaFileContract className="text-gray-500" />;
    case 'PENDING_APPROVAL':
      return <FaClock className="text-yellow-500" />;
    case 'APPROVED':
      return <FaCheck className="text-blue-500" />;
    case 'SIGNED':
      return <FaSignature className="text-green-500" />;
    case 'PRINTED':
      return <FaPrint className="text-purple-500" />;
    case 'CANCELLED':
      return <FaExclamationTriangle className="text-red-500" />;
    case 'EXPIRED':
      return <FaClock className="text-gray-400" />;
    default:
      return <FaFileContract className="text-gray-500" />;
  }
};

export default function ContractsPage() {
  const { currentWorkspace } = useWorkspace();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [contractPermissions, setContractPermissions] = useState({
    canView: false,
    canCreate: false,
    canEdit: false,
    canApprove: false,
    canReject: false,
    canSign: false,
    canPrint: false,
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadContracts();
    loadCurrentUser();
  }, []);

  const loadContracts = async () => {
    try {
      setLoading(true);
      const response = await salesAPI.getContracts();
      if (response.data.success) {
        setContracts(response.data.data);
      }
    } catch (error) {
      console.error('Error loading contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user = response.data.data;
        setCurrentUser(user);
        setContractPermissions(getContractPermissions(user));
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const filteredContracts = contracts.filter(contract => {
    const customerName = `${contract.customer.firstName} ${contract.customer.lastName}`.toLowerCase();
    const companyName = contract.customer.companyName?.toLowerCase() || '';
    const projectManager = contract.customer.projectManagerName?.toLowerCase() || '';
    
    const matchesSearch = contract.titlePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         contract.contractNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customerName.includes(searchTerm.toLowerCase()) ||
                         companyName.includes(searchTerm.toLowerCase()) ||
                         projectManager.includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'ALL' || contract.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('fa-IR').format(amount) + ' ' + currency;
  };

  const handleStatusAction = async (contractId: string, action: string) => {
    setActionLoading(contractId);
    try {
      let response;
      switch (action) {
        case 'approve':
          response = await salesAPI.approveContract(contractId);
          break;
        case 'reject':
          response = await salesAPI.rejectContract(contractId);
          break;
        case 'sign':
          response = await salesAPI.signContract(contractId);
          break;
        case 'print':
          response = await salesAPI.printContract(contractId);
          break;
        default:
          return;
      }
      
      if (response.data.success) {
        // Reload contracts to reflect the status change
        await loadContracts();
      } else {
        console.error('Error:', response.data.error);
      }
    } catch (error: any) {
      console.error(`Error ${action}ing contract:`, error);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">مدیریت قراردادها</h1>
          <p className="text-gray-300">مشاهده و مدیریت تمام قراردادهای فروش</p>
        </div>
        <Link
          href="/dashboard/sales/contracts/create"
          className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
        >
          <FaPlus className="text-lg" />
          قرارداد جدید
        </Link>
      </div>

      {/* Filters */}
      <div className="glass-liquid-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="جستجو در قراردادها، مشتریان، شرکت‌ها..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Status Filter */}
          <div className="md:w-64">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            >
              <option value="ALL">همه وضعیت‌ها</option>
              <option value="DRAFT">پیش‌نویس</option>
              <option value="PENDING_APPROVAL">در انتظار تایید</option>
              <option value="APPROVED">تایید شده</option>
              <option value="SIGNED">امضا شده</option>
              <option value="PRINTED">چاپ شده</option>
              <option value="CANCELLED">لغو شده</option>
              <option value="EXPIRED">منقضی شده</option>
            </select>
          </div>
        </div>
      </div>

      {/* Contracts List */}
      <div className="glass-liquid-card p-6">
        {filteredContracts.length === 0 ? (
          <div className="text-center py-8">
            <FaFileContract className="mx-auto text-4xl text-gray-400 mb-4" />
            <p className="text-gray-400">
              {searchTerm || statusFilter !== 'ALL' ? 'قراردادی یافت نشد' : 'هنوز قراردادی ایجاد نشده است'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredContracts.map((contract) => (
              <div key={contract.id} className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-all duration-200">
                <div className="flex items-center gap-4">
                  <div className="glass-liquid-card p-3">
                    {getStatusIcon(contract.status)}
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{contract.titlePersian}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-teal-400 text-sm font-medium">مشتری:</span>
                      <span className="text-gray-300 text-sm">
                        {contract.customer.firstName} {contract.customer.lastName}
                        {contract.customer.companyName && ` (${contract.customer.companyName})`}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400 mt-1">
                      <span>شماره: {contract.contractNumber}</span>
                      <span>مبلغ: {formatCurrency(contract.totalAmount, contract.currency)}</span>
                      <span>تاریخ: {PersianCalendar.formatForDisplay(contract.createdAt)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[contract.status as keyof typeof statusColors]}`}>
                    {statusLabels[contract.status as keyof typeof statusLabels]}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    <Link 
                      href={`/dashboard/sales/contracts/${contract.id}`}
                      className="p-2 text-gray-400 hover:text-teal-500 transition-colors"
                      title="مشاهده قرارداد"
                    >
                      <FaEye className="w-4 h-4" />
                    </Link>
                    {contract.status === 'DRAFT' && (
                      <Link 
                        href={`/dashboard/sales/contracts/${contract.id}/edit`}
                        className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                        title="ویرایش قرارداد"
                      >
                        <FaEdit className="w-4 h-4" />
                      </Link>
                    )}
                    {contract.status === 'DRAFT' && contractPermissions.canApprove && (
                      <button 
                        onClick={() => handleStatusAction(contract.id, 'approve')}
                        disabled={actionLoading === contract.id}
                        className="p-2 text-gray-400 hover:text-green-500 transition-colors disabled:opacity-50"
                        title="تایید قرارداد"
                      >
                        {actionLoading === contract.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>
                        ) : (
                          <FaCheck className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    {contract.status === 'DRAFT' && contractPermissions.canReject && (
                      <button 
                        onClick={() => handleStatusAction(contract.id, 'reject')}
                        disabled={actionLoading === contract.id}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                        title="رد قرارداد"
                      >
                        {actionLoading === contract.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500"></div>
                        ) : (
                          <FaTimes className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    {contract.status === 'PENDING_APPROVAL' && contractPermissions.canApprove && (
                      <button 
                        onClick={() => handleStatusAction(contract.id, 'approve')}
                        disabled={actionLoading === contract.id}
                        className="p-2 text-gray-400 hover:text-green-500 transition-colors disabled:opacity-50"
                        title="تایید قرارداد"
                      >
                        {actionLoading === contract.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>
                        ) : (
                          <FaCheck className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    {contract.status === 'PENDING_APPROVAL' && contractPermissions.canReject && (
                      <button 
                        onClick={() => handleStatusAction(contract.id, 'reject')}
                        disabled={actionLoading === contract.id}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                        title="رد قرارداد"
                      >
                        {actionLoading === contract.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500"></div>
                        ) : (
                          <FaTimes className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    {contract.status === 'APPROVED' && contractPermissions.canSign && (
                      <button 
                        onClick={() => handleStatusAction(contract.id, 'sign')}
                        disabled={actionLoading === contract.id}
                        className="p-2 text-gray-400 hover:text-green-500 transition-colors disabled:opacity-50"
                        title="امضای قرارداد"
                      >
                        {actionLoading === contract.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>
                        ) : (
                          <FaSignature className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    {contract.status === 'SIGNED' && contractPermissions.canPrint && (
                      <button 
                        onClick={() => handleStatusAction(contract.id, 'print')}
                        disabled={actionLoading === contract.id}
                        className="p-2 text-gray-400 hover:text-purple-500 transition-colors disabled:opacity-50"
                        title="چاپ قرارداد"
                      >
                        {actionLoading === contract.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500"></div>
                        ) : (
                          <FaPrint className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

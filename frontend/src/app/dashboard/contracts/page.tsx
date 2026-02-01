'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FaPlus, FaSearch, FaFilter, FaFileContract, FaEye, FaEdit, FaCheck, FaSignature, FaPrint } from 'react-icons/fa';
import { contractsAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  titlePersian: string;
  status: string;
  totalAmount: number | null;
  currency: string;
  createdAt: string;
  contractData: any; // JSON field containing all form data
  customer: {
    firstName: string;
    lastName: string;
    companyName: string | null;
  };
  department: {
    namePersian: string;
  };
  createdByUser: {
    firstName: string;
    lastName: string;
  };
}

const statusColors = {
  DRAFT: 'text-gray-500',
  PENDING_APPROVAL: 'text-yellow-500',
  APPROVED: 'text-blue-500',
  SIGNED: 'text-green-500',
  PRINTED: 'text-purple-500',
  CANCELLED: 'text-red-500',
  EXPIRED: 'text-gray-400'
};

const statusLabels = {
  DRAFT: 'پیش نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده'
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      setLoading(true);
      const response = await contractsAPI.getAll({ limit: 50 });
      
      if (response.data.success) {
        console.log('Contracts API Response:', response.data);
        console.log('Contracts Data:', response.data.data);
        setContracts(response.data.data);
      } else {
        console.error('Error fetching contracts:', response.data.error);
        setContracts([]);
      }
    } catch (error) {
      console.error('Error fetching contracts:', error);
      setContracts([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredContracts = contracts.filter(contract => {
    const matchesSearch = 
      contract.contractNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contract.titlePersian.includes(searchTerm) ||
      contract.customer.firstName.includes(searchTerm) ||
      contract.customer.lastName.includes(searchTerm) ||
      (contract.customer.companyName && contract.customer.companyName.includes(searchTerm)) ||
      (contract.contractData?.formNumber && contract.contractData.formNumber.includes(searchTerm)) ||
      (contract.contractData?.buyerName && contract.contractData.buyerName.includes(searchTerm)) ||
      (contract.contractData?.buyerNationalId && contract.contractData.buyerNationalId.includes(searchTerm)) ||
      (contract.contractData?.buyerPhone && contract.contractData.buyerPhone.includes(searchTerm)) ||
      (contract.contractData?.projectAddress && contract.contractData.projectAddress.includes(searchTerm));
    
    const matchesStatus = !statusFilter || contract.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const formatDate = (dateString: string) => {
    return PersianCalendar.formatForDisplay(dateString);
  };

  const formatAmount = (amount: number | null, currency: string) => {
    if (!amount) return 'نامشخص';
    return `${amount.toLocaleString('fa-IR')} ${currency}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">مدیریت قراردادها</h1>
          <p className="text-gray-300">مدیریت و پیگیری قراردادهای فروش</p>
        </div>
        <Link 
          href="/dashboard/contracts/create" 
          className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
        >
          <FaPlus className="text-lg" />
          قرارداد جدید
        </Link>
      </div>

      {/* Search and Filter */}
      <div className="glass-liquid-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="جستجو در قراردادها، شماره فرم، نام خریدار، کد ملی، شماره تماس..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="glass-liquid-input w-full pr-10"
            />
          </div>
          <div className="md:w-64">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="glass-liquid-input w-full"
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="DRAFT">پیش نویس</option>
              <option value="PENDING_APPROVAL">در انتظار تایید</option>
              <option value="APPROVED">تایید شده</option>
              <option value="SIGNED">امضا شده</option>
              <option value="PRINTED">چاپ شده</option>
              <option value="CANCELLED">لغو شده</option>
            </select>
          </div>
        </div>
      </div>

      {/* Contracts List */}
      <div className="glass-liquid-card p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredContracts.length === 0 ? (
              <div className="text-center py-12">
                <FaFileContract className="mx-auto text-6xl text-gray-400 mb-4" />
                <h3 className="text-xl font-semibold text-gray-300 mb-2">قراردادی یافت نشد</h3>
                <p className="text-gray-400 mb-6">هنوز قراردادی ایجاد نشده است</p>
                <Link href="/dashboard/contracts/create" className="glass-liquid-btn-primary">
                  ایجاد اولین قرارداد
                </Link>
              </div>
            ) : (
              filteredContracts.map((contract) => (
                <div key={contract.id} className="glass-liquid-card p-6 hover:bg-white/5 transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-3">
                        <h3 className="text-xl font-semibold text-white">
                          {contract.titlePersian}
                        </h3>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[contract.status as keyof typeof statusColors]} bg-white/10`}>
                          {statusLabels[contract.status as keyof typeof statusLabels]}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-300">
                        <div>
                          <span className="text-gray-400">شماره قرارداد:</span>
                          <span className="mr-2 font-mono">{contract.contractNumber}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">شماره فرم:</span>
                          <span className="mr-2 font-mono">{contract.contractData?.formNumber || 'نامشخص'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">تاریخ فرم:</span>
                          <span className="mr-2">{contract.contractData?.formDate || 'نامشخص'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">نام خریدار:</span>
                          <span className="mr-2">{contract.contractData?.buyerName || 'نامشخص'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">کد ملی:</span>
                          <span className="mr-2">{contract.contractData?.buyerNationalId || 'نامشخص'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">شماره تماس:</span>
                          <span className="mr-2">{contract.contractData?.buyerPhone || 'نامشخص'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">آدرس پروژه:</span>
                          <span className="mr-2">{contract.contractData?.projectAddress || 'نامشخص'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">نحوه تسویه:</span>
                          <span className="mr-2">{contract.contractData?.paymentMethod || 'نامشخص'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">مبلغ کل:</span>
                          <span className="mr-2 font-semibold text-teal-400">
                            {contract.contractData?.totalAmount ? 
                              `${contract.contractData.totalAmount.toLocaleString('fa-IR')} ریال` : 
                              formatAmount(contract.totalAmount, contract.currency)
                            }
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400">تعداد اقلام:</span>
                          <span className="mr-2">{contract.contractData?.items?.length || 0} قلم</span>
                        </div>
                        <div>
                          <span className="text-gray-400">بخش:</span>
                          <span className="mr-2">{contract.department.namePersian}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">ایجاد شده توسط:</span>
                          <span className="mr-2">
                            {contract.createdByUser.firstName} {contract.createdByUser.lastName}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400">تاریخ ایجاد:</span>
                          <span className="mr-2">{formatDate(contract.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Link 
                        href={`/dashboard/contracts/${contract.id}`}
                        className="glass-liquid-btn p-3"
                        title="مشاهده"
                      >
                        <FaEye />
                      </Link>
                      {contract.status === 'DRAFT' && (
                        <Link 
                          href={`/dashboard/contracts/${contract.id}/edit`}
                          className="glass-liquid-btn p-3"
                          title="ویرایش"
                        >
                          <FaEdit />
                        </Link>
                      )}
                      {contract.status === 'APPROVED' && (
                        <button 
                          className="glass-liquid-btn p-3 text-green-400"
                          title="امضا"
                        >
                          <FaSignature />
                        </button>
                      )}
                      {contract.status === 'SIGNED' && (
                        <button 
                          className="glass-liquid-btn p-3 text-purple-400"
                          title="چاپ"
                        >
                          <FaPrint />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
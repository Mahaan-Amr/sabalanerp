'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FaArrowRight, FaEdit, FaCheck, FaSignature, FaPrint, FaFileContract, FaUser, FaBuilding, FaCalendar } from 'react-icons/fa';
import { contractsAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  titlePersian: string;
  content: string;
  status: string;
  totalAmount: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  signedAt: string | null;
  printedAt: string | null;
  contractData: any; // JSON field containing all form data
  customer: {
    firstName: string;
    lastName: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  department: {
    namePersian: string;
  };
  createdByUser: {
    firstName: string;
    lastName: string;
  };
  approvedByUser: {
    firstName: string;
    lastName: string;
  } | null;
  signedByUser: {
    firstName: string;
    lastName: string;
  } | null;
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
  DRAFT: 'پیش نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده'
};

export default function ContractDetailsPage({ params }: { params: { id: string } }) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    fetchContract();
  }, [params.id]);

  useEffect(() => {
    try {
      const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      if (userStr) setCurrentUser(JSON.parse(userStr));
    } catch {}
  }, []);

  const fetchContract = async () => {
    try {
      setLoading(true);
      const response = await contractsAPI.getById(params.id);
      
      if (response.data.success) {
        console.log('Contract Details API Response:', response.data);
        console.log('Contract Data:', response.data.data);
        setContract(response.data.data);
      } else {
        console.error('Error fetching contract:', response.data.error);
        setContract(null);
      }
    } catch (error) {
      console.error('Error fetching contract:', error);
      setContract(null);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return PersianCalendar.formatForDisplay(dateString);
  };

  const formatAmount = (amount: number | null, currency: string) => {
    if (!amount) return 'نامشخص';
    return `${amount.toLocaleString('fa-IR')} ${currency}`;
  };

  const getPrintedPdfUrl = () => {
    // If backend stored path under signatures.print.pdfPath, expose a link
    const pdfPath = (contract as any)?.signatures?.print?.pdfPath as string | undefined;
    if (!pdfPath) return null;
    // Backend serves under /files/contracts
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000');
    // When pdfPath is absolute, return as-is; otherwise map to served path
    if (pdfPath.startsWith('http')) return pdfPath;
    const fileName = pdfPath.split(/[/\\]/).pop();
    // Always add timestamp to force fresh download
    const ts = Date.now();
    return `${apiBase}/files/contracts/${fileName}?t=${ts}`;
  };

  const handleAction = async (action: string) => {
    try {
      const note = typeof window !== 'undefined' ? window.prompt('توضیح (اختیاری):') || undefined : undefined;
      if (action === 'approve') {
        if (!confirm('آیا از تایید این قرارداد مطمئن هستید؟')) return;
        await contractsAPI.approve(params.id, note);
      } else if (action === 'reject') {
        const ok = confirm('آیا از رد/لغو این قرارداد مطمئن هستید؟');
        if (!ok) return;
        await contractsAPI.reject(params.id, note);
      } else if (action === 'sign') {
        if (!confirm('آیا از امضای این قرارداد مطمئن هستید؟')) return;
        await contractsAPI.sign(params.id, note);
      } else if (action === 'print') {
        if (!confirm('آیا از چاپ این قرارداد مطمئن هستید؟')) return;
        await contractsAPI.print(params.id, note);
      }
      await fetchContract();
    } catch (error) {
      console.error('Error performing action:', error);
      alert('خطا در انجام عملیات');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-white mb-4">قرارداد یافت نشد</h1>
        <Link href="/dashboard/contracts" className="glass-liquid-btn-primary">
          بازگشت به لیست قراردادها
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/contracts" className="glass-liquid-btn p-3">
          <FaArrowRight />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white mb-2">{contract.titlePersian}</h1>
          <p className="text-gray-300">شماره قرارداد: {contract.contractNumber}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-4 py-2 rounded-full text-sm font-medium ${statusColors[contract.status as keyof typeof statusColors]}`}>
            {statusLabels[contract.status as keyof typeof statusLabels]}
          </span>
          
          {contract.status === 'DRAFT' && (
            <Link href={`/dashboard/contracts/${contract.id}/edit`} className="glass-liquid-btn p-3">
              <FaEdit />
            </Link>
          )}
          
          {/* Approve/Reject - only ADMIN by backend policy */}
          {currentUser?.role === 'ADMIN' && contract.status === 'DRAFT' && (
            <button
              onClick={() => handleAction('approve')}
              className="glass-liquid-btn p-3 text-blue-400"
              title="تایید قرارداد"
            >
              <FaCheck />
            </button>
          )}

          {currentUser?.role === 'ADMIN' && (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && (
            <button
              onClick={() => handleAction('reject')}
              className="glass-liquid-btn p-3 text-red-400"
              title="رد قرارداد"
            >
              <FaCheck style={{ transform: 'rotate(45deg)' }} />
            </button>
          )}

          {contract.status === 'APPROVED' && (
            <button 
              onClick={() => handleAction('sign')}
              className="glass-liquid-btn p-3 text-green-400"
            >
              <FaSignature />
            </button>
          )}
          
          {(contract.status === 'SIGNED' || contract.status === 'PRINTED') && (
            <button 
              onClick={() => handleAction('print')}
              className="glass-liquid-btn p-3 text-purple-400"
            >
              <FaPrint />
            </button>
          )}

          {contract.status === 'PRINTED' && getPrintedPdfUrl() && (
            <a
              href={getPrintedPdfUrl()!}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-liquid-btn p-3 text-teal-400"
            >
              دانلود PDF
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contract Information */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contract Content */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <FaFileContract className="text-teal-400" />
              محتوای قرارداد
            </h2>
            
            {/* Form Data Display */}
            {contract.contractData && (
              <div className="space-y-6">
                {/* Basic Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">اطلاعات پایه</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">شماره فرم:</span>
                      <span className="mr-2 text-white">{contract.contractData.formNumber || 'نامشخص'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">تاریخ فرم:</span>
                      <span className="mr-2 text-white">{contract.contractData.formDate || 'نامشخص'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">تاریخ قرارداد:</span>
                      <span className="mr-2 text-white">{contract.contractData.contractDate || 'نامشخص'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">نحوه تسویه:</span>
                      <span className="mr-2 text-white">{contract.contractData.paymentMethod || 'نامشخص'}</span>
                    </div>
                  </div>
                </div>

                {/* Buyer Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">اطلاعات خریدار</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">نام و نام خانوادگی:</span>
                      <span className="mr-2 text-white">{contract.contractData.buyerName || 'نامشخص'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">کد ملی:</span>
                      <span className="mr-2 text-white">{contract.contractData.buyerNationalId || 'نامشخص'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">شماره تماس:</span>
                      <span className="mr-2 text-white">{contract.contractData.buyerPhone || 'نامشخص'}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">آدرس پروژه:</span>
                      <span className="mr-2 text-white">{contract.contractData.projectAddress || 'نامشخص'}</span>
                    </div>
                  </div>
                </div>

                {/* Product Items */}
                {contract.contractData.items && contract.contractData.items.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">اقلام قرارداد</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="text-right text-white p-3">ردیف</th>
                            <th className="text-right text-white p-3">کد</th>
                            <th className="text-right text-white p-3">نوع سنگ</th>
                            <th className="text-right text-white p-3">قطر</th>
                            <th className="text-right text-white p-3">طول</th>
                            <th className="text-right text-white p-3">عرض</th>
                            <th className="text-right text-white p-3">تعداد</th>
                            <th className="text-right text-white p-3">متر مربع</th>
                            <th className="text-right text-white p-3">فی</th>
                            <th className="text-right text-white p-3">قیمت کل</th>
                            <th className="text-right text-white p-3">توضیحات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contract.contractData.items.map((item: any, index: number) => (
                            <tr key={item.id || index} className="border-b border-gray-700/50">
                              <td className="p-3 text-gray-300">{index + 1}</td>
                              <td className="p-3 text-white">{item.code || '-'}</td>
                              <td className="p-3 text-white">{item.stoneType || '-'}</td>
                              <td className="p-3 text-white">{item.thickness || '-'}</td>
                              <td className="p-3 text-white">{item.length || 0}</td>
                              <td className="p-3 text-white">{item.width || 0}</td>
                              <td className="p-3 text-white">{item.quantity || 0}</td>
                              <td className="p-3 text-white">{item.squareMeter || 0}</td>
                              <td className="p-3 text-white">{item.unitPrice ? item.unitPrice.toLocaleString('fa-IR') : 0} ریال</td>
                              <td className="p-3 text-white">{item.totalPrice ? item.totalPrice.toLocaleString('fa-IR') : 0} ریال</td>
                              <td className="p-3 text-white">{item.description || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Total Amount */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">خلاصه مالی</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">مبلغ کل:</span>
                      <span className="mr-2 font-semibold text-teal-400">
                        {contract.contractData.totalAmount ? 
                          `${contract.contractData.totalAmount.toLocaleString('fa-IR')} ریال` : 
                          formatAmount(contract.totalAmount, contract.currency)
                        }
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">مبلغ کل به حروف:</span>
                      <span className="mr-2 text-white">{contract.contractData.totalAmountWords || 'نامشخص'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fallback to HTML content if no contractData */}
            {!contract.contractData && contract.content && (
              <div 
                className="prose prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: contract.content }}
              />
            )}
          </div>

          {/* Notes */}
          {contract.notes && (
            <div className="glass-liquid-card p-6">
              <h2 className="text-xl font-semibold text-white mb-4">یادداشت‌ها</h2>
              <p className="text-gray-300">{contract.notes}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Information */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <FaUser className="text-teal-400" />
              اطلاعات مشتری
            </h2>
            <div className="space-y-3 text-sm">
              {/* Show buyer info from contractData if available, otherwise fallback to customer relationship */}
              {contract.contractData?.buyerName ? (
                <>
                  <div>
                    <span className="text-gray-400">نام خریدار:</span>
                    <span className="mr-2 text-white">{contract.contractData.buyerName}</span>
                  </div>
                  {contract.contractData.buyerNationalId && (
                    <div>
                      <span className="text-gray-400">کد ملی:</span>
                      <span className="mr-2 text-white">{contract.contractData.buyerNationalId}</span>
                    </div>
                  )}
                  {contract.contractData.buyerPhone && (
                    <div>
                      <span className="text-gray-400">شماره تماس:</span>
                      <span className="mr-2 text-white">{contract.contractData.buyerPhone}</span>
                    </div>
                  )}
                  {contract.contractData.projectAddress && (
                    <div>
                      <span className="text-gray-400">آدرس پروژه:</span>
                      <span className="mr-2 text-white">{contract.contractData.projectAddress}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <span className="text-gray-400">نام:</span>
                    <span className="mr-2 text-white">
                      {contract.customer.firstName} {contract.customer.lastName}
                    </span>
                  </div>
                  {contract.customer.companyName && (
                    <div>
                      <span className="text-gray-400">شرکت:</span>
                      <span className="mr-2 text-white">{contract.customer.companyName}</span>
                    </div>
                  )}
                  {contract.customer.email && (
                    <div>
                      <span className="text-gray-400">ایمیل:</span>
                      <span className="mr-2 text-white">{contract.customer.email}</span>
                    </div>
                  )}
                  {contract.customer.phone && (
                    <div>
                      <span className="text-gray-400">تلفن:</span>
                      <span className="mr-2 text-white">{contract.customer.phone}</span>
                    </div>
                  )}
                  {contract.customer.address && (
                    <div>
                      <span className="text-gray-400">آدرس:</span>
                      <span className="mr-2 text-white">{contract.customer.address}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Contract Details */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <FaBuilding className="text-teal-400" />
              جزئیات قرارداد
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-400">مبلغ کل:</span>
                <span className="mr-2 font-semibold text-teal-400">
                  {formatAmount(contract.totalAmount, contract.currency)}
                </span>
              </div>
              <div>
                <span className="text-gray-400">بخش:</span>
                <span className="mr-2 text-white">{contract.department.namePersian}</span>
              </div>
              <div>
                <span className="text-gray-400">ایجاد شده توسط:</span>
                <span className="mr-2 text-white">
                  {contract.createdByUser.firstName} {contract.createdByUser.lastName}
                </span>
              </div>
              {contract.approvedByUser && (
                <div>
                  <span className="text-gray-400">تایید شده توسط:</span>
                  <span className="mr-2 text-white">
                    {contract.approvedByUser.firstName} {contract.approvedByUser.lastName}
                  </span>
                </div>
              )}
              {contract.signedByUser && (
                <div>
                  <span className="text-gray-400">امضا شده توسط:</span>
                  <span className="mr-2 text-white">
                    {contract.signedByUser.firstName} {contract.signedByUser.lastName}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <FaCalendar className="text-teal-400" />
              زمان‌بندی
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-400">تاریخ ایجاد:</span>
                <span className="mr-2 text-white">{formatDate(contract.createdAt)}</span>
              </div>
              {contract.signedAt && (
                <div>
                  <span className="text-gray-400">تاریخ امضا:</span>
                  <span className="mr-2 text-white">{formatDate(contract.signedAt)}</span>
                </div>
              )}
              {contract.printedAt && (
                <div>
                  <span className="text-gray-400">تاریخ چاپ:</span>
                  <span className="mr-2 text-white">{formatDate(contract.printedAt)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  FaArrowRight, 
  FaEdit,
  FaCheck,
  FaTimes,
  FaSignature,
  FaPrint,
  FaFileContract,
  FaUser,
  FaBuilding,
  FaCalendarAlt,
  FaDollarSign,
  FaEye,
  FaTruck,
  FaCreditCard
} from 'react-icons/fa';
import { salesAPI, dashboardAPI } from '@/lib/api';
import { formatPrice } from '@/lib/numberFormat';
import PersianCalendar from '@/lib/persian-calendar';
import { getContractPermissions, User as PermissionUser } from '@/lib/permissions';

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  titlePersian: string;
  content: string;
  status: string;
  totalAmount: number;
  currency: string;
  notes?: string;
  contractData?: any;
  signatures?: any;
  createdAt: string;
  updatedAt: string;
  signedAt?: string;
  printedAt?: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    customerType: string;
    primaryContact?: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
    };
  };
  department: {
    id: string;
    name: string;
    namePersian: string;
  };
  createdByUser: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  approvedByUser?: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  signedByUser?: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  items?: any[];
  deliveries?: any[];
  payments?: any[];
}

interface User extends PermissionUser {}

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

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contractId = params.id as string;
  
  const [contract, setContract] = useState<Contract | null>(null);
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadContract();
    loadCurrentUser();
  }, [contractId]);

  const loadContract = async () => {
    try {
      setLoading(true);
      const response = await salesAPI.getContract(contractId);
      if (response.data.success) {
        setContract(response.data.data);
      } else {
        setError('قرارداد یافت نشد');
      }
    } catch (error: any) {
      console.error('Error loading contract:', error);
      setError(error.response?.data?.error || 'خطا در بارگذاری قرارداد');
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

  const handleAction = async (action: string, note?: string) => {
    if (!contract) return;
    
    setActionLoading(action);
    try {
      let response;
      switch (action) {
        case 'approve':
          response = await salesAPI.approveContract(contract.id, note);
          break;
        case 'reject':
          response = await salesAPI.rejectContract(contract.id, note);
          break;
        case 'sign':
          response = await salesAPI.signContract(contract.id, note);
          break;
        case 'print':
          response = await salesAPI.printContract(contract.id, note);
          break;
        default:
          return;
      }
      
      if (response.data.success) {
        setContract(response.data.data);
      } else {
        setError(response.data.error || 'خطا در انجام عملیات');
      }
    } catch (error: any) {
      console.error(`Error ${action}ing contract:`, error);
      setError(error.response?.data?.error || 'خطا در انجام عملیات');
    } finally {
      setActionLoading(null);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('fa-IR').format(amount) + ' ' + currency;
  };

  const canEdit = contract && contract.status === 'DRAFT' && 
    (contractPermissions.canEdit || contract.createdByUser.id === currentUser?.id);

  const canApprove = contract && (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && 
    contractPermissions.canApprove;

  const canReject = contract && (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && 
    contractPermissions.canReject;

  const canSign = contract && contract.status === 'APPROVED' && 
    contractPermissions.canSign;

  const canPrint = contract && (contract.status === 'SIGNED' || contract.status === 'PRINTED') && 
    contractPermissions.canPrint;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="text-center py-12">
        <FaFileContract className="mx-auto text-4xl text-gray-400 mb-4" />
        <p className="text-gray-400 mb-4">{error || 'قرارداد یافت نشد'}</p>
        <Link href="/dashboard/sales/contracts" className="glass-liquid-btn-primary">
          بازگشت به لیست قراردادها
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/sales/contracts" className="glass-liquid-btn p-3">
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
          
          {canEdit && (
            <Link href={`/dashboard/sales/contracts/${contract.id}/edit`} className="glass-liquid-btn p-3">
              <FaEdit />
            </Link>
          )}
          
          {canApprove && (
            <button
              onClick={() => handleAction('approve')}
              disabled={actionLoading === 'approve'}
              className="glass-liquid-btn p-3 text-green-400 hover:text-green-300 disabled:opacity-50"
              title="تایید قرارداد"
            >
              {actionLoading === 'approve' ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-400"></div>
              ) : (
                <FaCheck />
              )}
            </button>
          )}

          {canReject && (
            <button
              onClick={() => handleAction('reject')}
              disabled={actionLoading === 'reject'}
              className="glass-liquid-btn p-3 text-red-400 hover:text-red-300 disabled:opacity-50"
              title="رد قرارداد"
            >
              {actionLoading === 'reject' ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-400"></div>
              ) : (
                <FaTimes />
              )}
            </button>
          )}

          {canSign && (
            <button
              onClick={() => handleAction('sign')}
              disabled={actionLoading === 'sign'}
              className="glass-liquid-btn p-3 text-blue-400 hover:text-blue-300 disabled:opacity-50"
              title="امضای قرارداد"
            >
              {actionLoading === 'sign' ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
              ) : (
                <FaSignature />
              )}
            </button>
          )}

          {canPrint && (
            <button
              onClick={() => handleAction('print')}
              disabled={actionLoading === 'print'}
              className="glass-liquid-btn p-3 text-purple-400 hover:text-purple-300 disabled:opacity-50"
              title="چاپ قرارداد"
            >
              {actionLoading === 'print' ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-400"></div>
              ) : (
                <FaPrint />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Contract Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contract Information */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <FaFileContract className="text-teal-400" />
              اطلاعات قرارداد
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">شماره قرارداد</label>
                  <p className="text-white">{contract.contractNumber}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">وضعیت</label>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${statusColors[contract.status as keyof typeof statusColors]}`}>
                    {statusLabels[contract.status as keyof typeof statusLabels]}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">مبلغ کل</label>
                  <p className="text-white font-semibold">
                    {contract.totalAmount 
                      ? formatCurrency(contract.totalAmount, contract.currency)
                      : contract.items && contract.items.length > 0
                      ? formatCurrency(
                          contract.items.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0),
                          contract.currency
                        )
                      : contract.contractData?.products && contract.contractData.products.length > 0
                      ? formatCurrency(
                          contract.contractData.products.reduce((sum: number, product: any) => sum + (product.totalPrice || 0), 0),
                          contract.currency || 'تومان'
                        )
                      : 'نامشخص'
                    }
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">تاریخ ایجاد</label>
                  <p className="text-white">{PersianCalendar.formatForDisplay(contract.createdAt)}</p>
                </div>
              </div>
              
              {contract.notes && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">یادداشت‌ها</label>
                  <p className="text-white bg-white/5 p-3 rounded-lg">{contract.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Contract Content */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4">محتوای قرارداد</h2>
            <div className="space-y-6">
              {/* Contract Data Display */}
              {contract.contractData && (
                <div className="space-y-4">
                  {/* Contract Information */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">شماره قرارداد</label>
                      <p className="text-white">{contract.contractData.contractNumber}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">تاریخ قرارداد</label>
                      <p className="text-white">{contract.contractData.contractDate}</p>
                    </div>
                  </div>

                  {/* Customer Information */}
                  {contract.contractData.customer && (
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-3">اطلاعات مشتری</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">نام</label>
                          <p className="text-white">{contract.contractData.customer.firstName} {contract.contractData.customer.lastName}</p>
                        </div>
                        {contract.contractData.customer.companyName && (
                          <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">نام شرکت</label>
                            <p className="text-white">{contract.contractData.customer.companyName}</p>
                          </div>
                        )}
                        {contract.contractData.customer.phoneNumbers && contract.contractData.customer.phoneNumbers.length > 0 && (
                          <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">شماره تماس</label>
                            <p className="text-white">{contract.contractData.customer.phoneNumbers[0].number}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Project Information */}
                  {contract.contractData.project && (
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-3">اطلاعات پروژه</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">آدرس پروژه</label>
                          <p className="text-white">{contract.contractData.project.address || 'نامشخص'}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">نام پروژه</label>
                          <p className="text-white">{contract.contractData.project.name || 'نامشخص'}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Products */}
                  {((contract.items && contract.items.length > 0) || (contract.contractData?.products && contract.contractData.products.length > 0)) && (
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-3">اقلام قرارداد</h3>
                      <div className="space-y-4">
                        {(() => {
                          // Get items from contract.items or contractData.products
                          const items = contract.items && contract.items.length > 0 
                            ? contract.items 
                            : (contract.contractData?.products || []);
                          
                          // Group items by stairSystemId
                          const stairSystemGroups = new Map<string, any[]>();
                          const regularItems: any[] = [];
                          
                          items.forEach((item: any) => {
                            // Check if item has stairSystemId (from contract.items) or productType === 'stair' (from contractData)
                            const isStairItem = item.stairSystemId || 
                                              (item.productType === 'stair' && item.stairSystemId) ||
                                              (item.productType === 'stair');
                            
                            if (isStairItem && item.stairSystemId) {
                              const systemId = item.stairSystemId;
                              if (!stairSystemGroups.has(systemId)) {
                                stairSystemGroups.set(systemId, []);
                              }
                              stairSystemGroups.get(systemId)!.push(item);
                            } else {
                              regularItems.push(item);
                            }
                          });
                          
                          return (
                            <>
                              {/* Stair System Groups */}
                              {Array.from(stairSystemGroups.entries()).map(([systemId, stairItems]) => {
                                // Sort by part type: tread, riser, landing
                                const partOrder: Record<string, number> = { 'tread': 0, 'riser': 1, 'landing': 2 };
                                stairItems.sort((a, b) => {
                                  const aOrder = partOrder[a.stairPartType as string] ?? 999;
                                  const bOrder = partOrder[b.stairPartType as string] ?? 999;
                                  return aOrder - bOrder;
                                });
                                
                                const firstItem = stairItems[0];
                                const totalSystemPrice = stairItems.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
                                const numberOfSteps = firstItem.numberOfSteps || 0;
                                const quantityType = firstItem.quantityType || 'steps';
                                
                                return (
                                  <div key={systemId} className="mb-6">
                                    {/* Stair System Group Header */}
                                    <div className="bg-gradient-to-r from-purple-500/20 to-purple-600/20 border-2 border-purple-400/50 rounded-lg p-4 mb-3">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <span className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-semibold bg-purple-500 text-white">
                                            دستگاه پله
                                          </span>
                                          <span className="text-sm text-gray-300">
                                            {numberOfSteps} پله ({quantityType === 'steps' ? 'تعداد پله' : 'تعداد پله‌کان'})
                                          </span>
                                        </div>
                                        <span className="text-lg font-bold text-purple-200">
                                          {formatPrice(totalSystemPrice, contract.currency || 'تومان')}
                                        </span>
                                      </div>
                                    </div>
                                    
                                    {/* Stair System Parts Table */}
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="border-b border-gray-600">
                                            <th className="text-right py-2 px-3 text-gray-400">بخش</th>
                                            <th className="text-right py-2 px-3 text-gray-400">نام محصول</th>
                                            <th className="text-right py-2 px-3 text-gray-400">ابعاد / مشخصات</th>
                                            <th className="text-right py-2 px-3 text-gray-400">تعداد</th>
                                            <th className="text-right py-2 px-3 text-gray-400">متر مربع</th>
                                            <th className="text-right py-2 px-3 text-gray-400">فی</th>
                                            <th className="text-right py-2 px-3 text-gray-400">قیمت کل</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {stairItems.map((item: any, idx: number) => {
                                            const partTypeLabel = item.stairPartType === 'tread' ? 'کف پله' :
                                                                  item.stairPartType === 'riser' ? 'خیز پله' :
                                                                  item.stairPartType === 'landing' ? 'پاگرد' : 'نامشخص';
                                            
                                            // Get stair-specific details from contractData if available
                                            const contractDataItem = contract.contractData?.products?.find((p: any) => 
                                              p.productId === item.productId && 
                                              p.stairSystemId === item.stairSystemId &&
                                              p.stairPartType === item.stairPartType
                                            );
                                            
                                            return (
                                              <tr key={idx} className="border-b border-gray-700/50 bg-purple-900/10">
                                                <td className="py-2 px-3">
                                                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-purple-500/30 text-purple-200">
                                                    {partTypeLabel}
                                                  </span>
                                                </td>
                                                <td className="py-2 px-3 text-white">
                                                  {item.product?.namePersian || item.product?.name || 
                                                   contractDataItem?.stoneName || 'نامشخص'}
                                                </td>
                                                <td className="py-2 px-3 text-white text-xs">
                                                  {/* Stair-specific dimensions */}
                                                  {item.stairPartType === 'tread' && (
                                                    <>
                                                      {contractDataItem?.treadWidth && (
                                                        <div>طول پله: {contractDataItem.treadWidth}{contractDataItem.lengthUnit || 'm'}</div>
                                                      )}
                                                      {contractDataItem?.treadDepth && (
                                                        <div>عرض پله: {contractDataItem.treadDepth}cm</div>
                                                      )}
                                                      {contractDataItem?.nosingType && contractDataItem.nosingType !== 'none' && (
                                                        <div className="text-purple-300">پیشانی: {contractDataItem.nosingType}</div>
                                                      )}
                                                      {contractDataItem?.nosingCuttingCost && contractDataItem.nosingCuttingCost > 0 && (
                                                        <div className="text-purple-300">هزینه برش پیشانی: {formatPrice(contractDataItem.nosingCuttingCost, 'تومان')}</div>
                                                      )}
                                                    </>
                                                  )}
                                                  {item.stairPartType === 'riser' && contractDataItem?.riserHeight && (
                                                    <div>ارتفاع قائمه: {contractDataItem.riserHeight}cm</div>
                                                  )}
                                                  {item.stairPartType === 'landing' && (
                                                    <>
                                                      {contractDataItem?.landingWidth && (
                                                        <div>عرض پاگرد: {contractDataItem.landingWidth}cm</div>
                                                      )}
                                                      {contractDataItem?.landingDepth && (
                                                        <div>عمق پاگرد: {contractDataItem.landingDepth}cm</div>
                                                      )}
                                                      {contractDataItem?.numberOfLandings && (
                                                        <div>تعداد پاگرد: {contractDataItem.numberOfLandings}</div>
                                                      )}
                                                    </>
                                                  )}
                                                  {/* Fallback to standard dimensions */}
                                                  {!contractDataItem && (
                                                    <>
                                                      {item.product?.widthValue && item.product?.thicknessValue 
                                                        ? `${item.product.widthValue} × ${item.product.thicknessValue}`
                                                        : 'نامشخص'}
                                                    </>
                                                  )}
                                                </td>
                                                <td className="py-2 px-3 text-white">{item.quantity || 0}</td>
                                                <td className="py-2 px-3 text-white">
                                                  {contractDataItem?.squareMeters 
                                                    ? new Intl.NumberFormat('fa-IR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(contractDataItem.squareMeters))
                                                    : (item.product?.squareMeter || 'نامشخص')}
                                                </td>
                                                <td className="py-2 px-3 text-white">
                                                  {item.unitPrice ? formatPrice(item.unitPrice, contract.currency || 'تومان') : 'نامشخص'}
                                                </td>
                                                <td className="py-2 px-3 text-white font-semibold">
                                                  {item.totalPrice ? formatPrice(item.totalPrice, contract.currency || 'تومان') : 'نامشخص'}
                                                  {item.isMandatory && item.mandatoryPercentage && (
                                                    <div className="text-xs text-yellow-400 mt-1">
                                                      حکمی (+{item.mandatoryPercentage}%)
                                                    </div>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })}
                              
                              {/* Regular Items Table */}
                              {regularItems.length > 0 && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-gray-600">
                                        <th className="text-right py-2 px-3 text-gray-400">نام محصول</th>
                                        <th className="text-right py-2 px-3 text-gray-400">ابعاد</th>
                                        <th className="text-right py-2 px-3 text-gray-400">تعداد</th>
                                        <th className="text-right py-2 px-3 text-gray-400">متر مربع</th>
                                        <th className="text-right py-2 px-3 text-gray-400">فی</th>
                                        <th className="text-right py-2 px-3 text-gray-400">قیمت کل</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {regularItems.map((item: any, index: number) => {
                                        // Handle both contract.items format and contractData.products format
                                        const productName = item.product?.namePersian || item.product?.name || 
                                                          item.namePersian || item.name || 'نامشخص';
                                        const dimensions = item.product?.widthValue && item.product?.thicknessValue 
                                          ? `${item.product.widthValue} × ${item.product.thicknessValue}`
                                          : (item.length && item.width 
                                            ? `${item.length} × ${item.width}`
                                            : 'نامشخص');
                                        const quantity = item.quantity || 0;
                                        const squareMeters = item.squareMeters || item.product?.squareMeter || 'نامشخص';
                                        const unitPrice = item.unitPrice || item.pricePerSquareMeter;
                                        const totalPrice = item.totalPrice || 0;
                                        const currency = item.currency || contract.currency || 'تومان';
                                        
                                        return (
                                          <tr key={index} className="border-b border-gray-700">
                                            <td className="py-2 px-3 text-white">{productName}</td>
                                            <td className="py-2 px-3 text-white">{dimensions}</td>
                                            <td className="py-2 px-3 text-white">{quantity}</td>
                                            <td className="py-2 px-3 text-white">
                                              {typeof squareMeters === 'number' 
                                                ? new Intl.NumberFormat('fa-IR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(squareMeters)
                                                : squareMeters}
                                            </td>
                                            <td className="py-2 px-3 text-white">
                                              {unitPrice ? formatPrice(unitPrice, currency) : 'نامشخص'}
                                            </td>
                                            <td className="py-2 px-3 text-white font-semibold">
                                              {totalPrice ? formatPrice(totalPrice, currency) : 'نامشخص'}
                                              {item.isMandatory && item.mandatoryPercentage && (
                                                <div className="text-xs text-yellow-400 mt-1">
                                                  حکمی (+{item.mandatoryPercentage}%)
                                                </div>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Payment Information */}
                  {contract.contractData.payment && (
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-3">اطلاعات پرداخت</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">نحوه پرداخت</label>
                          <p className="text-white">{contract.contractData.payment.method}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">مبلغ کل</label>
                          <p className="font-semibold text-teal-400">
                            {contract.contractData.payment.totalAmount 
                              ? formatPrice(contract.contractData.payment.totalAmount, contract.currency || 'تومان')
                              : contract.items && contract.items.length > 0
                              ? formatPrice(contract.items.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0), contract.currency || 'تومان')
                              : contract.contractData?.products && contract.contractData.products.length > 0
                              ? formatPrice(contract.contractData.products.reduce((sum: number, product: any) => sum + (product.totalPrice || 0), 0), contract.currency || 'تومان')
                              : 'نامشخص'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Deliveries */}
                  {contract.contractData.deliveries && contract.contractData.deliveries.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-3">برنامه تحویل</h3>
                      <div className="space-y-2">
                        {contract.contractData.deliveries.map((delivery: any, index: number) => (
                          <div key={index} className="bg-white/5 p-3 rounded-lg">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">تاریخ تحویل</label>
                                <p className="text-white">{delivery.deliveryDate}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">توضیحات</label>
                                <p className="text-white">{delivery.notes || 'بدون توضیحات'}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fallback to HTML content if no contractData */}
              {!contract.contractData && contract.content && (
                <div className="prose prose-invert max-w-none">
                  <div 
                    className="text-white whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: contract.content }}
                  />
                </div>
              )}

              {/* No content available */}
              {!contract.contractData && !contract.content && (
                <div className="text-center py-8">
                  <p className="text-gray-400">محتوای قرارداد در دسترس نیست</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Information */}
          <div className="glass-liquid-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <FaUser className="text-teal-400" />
              اطلاعات مشتری
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">نام</label>
                <p className="text-white">{contract.customer.firstName} {contract.customer.lastName}</p>
              </div>
              {contract.customer.companyName && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">نام شرکت</label>
                  <p className="text-white">{contract.customer.companyName}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">نوع مشتری</label>
                <p className="text-white">{contract.customer.customerType}</p>
              </div>
              {contract.customer.primaryContact && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">اطلاعات تماس</label>
                  <p className="text-white">{contract.customer.primaryContact.firstName} {contract.customer.primaryContact.lastName}</p>
                  {contract.customer.primaryContact.email && (
                    <p className="text-gray-300 text-sm">{contract.customer.primaryContact.email}</p>
                  )}
                  {contract.customer.primaryContact.phone && (
                    <p className="text-gray-300 text-sm">{contract.customer.primaryContact.phone}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Department Information */}
          <div className="glass-liquid-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <FaBuilding className="text-teal-400" />
              اطلاعات بخش
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">بخش</label>
                <p className="text-white">{contract.department.namePersian}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">ایجاد کننده</label>
                <p className="text-white">{contract.createdByUser.firstName} {contract.createdByUser.lastName}</p>
              </div>
              {contract.approvedByUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">تایید کننده</label>
                  <p className="text-white">{contract.approvedByUser.firstName} {contract.approvedByUser.lastName}</p>
                </div>
              )}
              {contract.signedByUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">امضا کننده</label>
                  <p className="text-white">{contract.signedByUser.firstName} {contract.signedByUser.lastName}</p>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="glass-liquid-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <FaCalendarAlt className="text-teal-400" />
              تاریخچه
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-teal-400 rounded-full"></div>
                <div>
                  <p className="text-white text-sm">ایجاد شده</p>
                  <p className="text-gray-400 text-xs">{PersianCalendar.formatForDisplay(contract.createdAt)}</p>
                </div>
              </div>
              {contract.signedAt && (
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <div>
                    <p className="text-white text-sm">امضا شده</p>
                    <p className="text-gray-400 text-xs">{PersianCalendar.formatForDisplay(contract.signedAt)}</p>
                  </div>
                </div>
              )}
              {contract.printedAt && (
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                  <div>
                    <p className="text-white text-sm">چاپ شده</p>
                    <p className="text-gray-400 text-xs">{PersianCalendar.formatForDisplay(contract.printedAt)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

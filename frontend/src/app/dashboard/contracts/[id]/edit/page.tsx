'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaArrowRight, FaSave, FaPlus, FaTrash } from 'react-icons/fa';
import { contractsAPI } from '@/lib/api';

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  titlePersian: string;
  status: string;
  totalAmount: number | null;
  currency: string;
  createdAt: string;
  contractData: any;
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

interface ProductItem {
  id: string;
  code: string;
  stoneType: string;
  thickness: string;
  length: number;
  width: number;
  quantity: number;
  squareMeter: number;
  unitPrice: number;
  totalPrice: number;
  description: string;
}

export default function EditContractPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form data state
  const [formData, setFormData] = useState({
    // Basic contract info
    title: 'قرارداد فروش سبلان استون',
    titlePersian: 'قرارداد فروش سبلان استون',
    
    // Form number and date
    formNumber: '',
    formDate: new Date().toLocaleDateString('fa-IR'),
    
    // Buyer information
    buyerName: '',
    buyerNationalId: '',
    buyerPhone: '',
    projectAddress: '',
    
    // Contract details
    contractDate: new Date().toLocaleDateString('fa-IR'),
    paymentMethod: '',
    
    // Product items
    items: [] as ProductItem[],
    
    // Calculated totals
    totalAmount: 0,
    totalAmountWords: ''
  });

  useEffect(() => {
    fetchContract();
  }, [params.id]);

  const fetchContract = async () => {
    try {
      setLoading(true);
      const response = await contractsAPI.getById(params.id);
      
      if (response.data.success) {
        const contractData = response.data.data;
        setContract(contractData);
        
        // Pre-fill form with existing contract data
        if (contractData.contractData) {
          setFormData({
            title: contractData.title || 'قرارداد فروش سبلان استون',
            titlePersian: contractData.titlePersian || 'قرارداد فروش سبلان استون',
            formNumber: contractData.contractData.formNumber || '',
            formDate: contractData.contractData.formDate || new Date().toLocaleDateString('fa-IR'),
            buyerName: contractData.contractData.buyerName || '',
            buyerNationalId: contractData.contractData.buyerNationalId || '',
            buyerPhone: contractData.contractData.buyerPhone || '',
            projectAddress: contractData.contractData.projectAddress || '',
            contractDate: contractData.contractData.contractDate || new Date().toLocaleDateString('fa-IR'),
            paymentMethod: contractData.contractData.paymentMethod || '',
            items: contractData.contractData.items || [],
            totalAmount: contractData.contractData.totalAmount || 0,
            totalAmountWords: contractData.contractData.totalAmountWords || ''
          });
        }
      } else {
        console.error('Error fetching contract:', response.data.error);
        router.push('/dashboard/contracts');
      }
    } catch (error) {
      console.error('Error fetching contract:', error);
      router.push('/dashboard/contracts');
    } finally {
      setLoading(false);
    }
  };

  const addProductItem = () => {
    const newItem: ProductItem = {
      id: `item-${Date.now()}`,
      code: '',
      stoneType: '',
      thickness: '',
      length: 0,
      width: 0,
      quantity: 0,
      squareMeter: 0,
      unitPrice: 0,
      totalPrice: 0,
      description: ''
    };
    
    setFormData({
      ...formData,
      items: [...formData.items, newItem]
    });
  };

  const removeProductItem = (itemId: string) => {
    setFormData({
      ...formData,
      items: formData.items.filter(item => item.id !== itemId)
    });
    calculateTotals();
  };

  const updateProductItem = (itemId: string, field: keyof ProductItem, value: any) => {
    const updatedItems = formData.items.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item, [field]: value };
        
        // Auto-calculate square meter if length or width changed
        if (field === 'length' || field === 'width') {
          updatedItem.squareMeter = updatedItem.length * updatedItem.width;
        }
        
        // Auto-calculate total price if square meter or unit price changed
        if (field === 'squareMeter' || field === 'unitPrice') {
          updatedItem.totalPrice = updatedItem.squareMeter * updatedItem.unitPrice;
        }
        
        return updatedItem;
      }
      return item;
    });
    
    setFormData({
      ...formData,
      items: updatedItems
    });
    
    // Calculate totals after updating items
    calculateTotals();
  };

  const calculateTotals = () => {
    const totalAmount = formData.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    
    // Convert to Persian words (simplified)
    const totalAmountWords = convertToPersianWords(totalAmount);
    
    setFormData(prev => ({
      ...prev,
      totalAmount,
      totalAmountWords
    }));
  };

  const convertToPersianWords = (amount: number): string => {
    // Simplified Persian number conversion
    const persianNumbers = ['صفر', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
    const tens = ['', 'ده', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
    const hundreds = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
    
    if (amount === 0) return 'صفر ریال';
    if (amount < 1000) return `${amount.toLocaleString('fa-IR')} ریال`;
    if (amount < 1000000) return `${Math.floor(amount / 1000)} هزار ریال`;
    if (amount < 1000000000) return `${Math.floor(amount / 1000000)} میلیون ریال`;
    return `${Math.floor(amount / 1000000000)} میلیارد ریال`;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.buyerName.trim()) {
      newErrors.buyerName = 'نام خریدار الزامی است';
    }
    
    if (!formData.buyerNationalId.trim()) {
      newErrors.buyerNationalId = 'کد ملی الزامی است';
    }
    
    if (!formData.buyerPhone.trim()) {
      newErrors.buyerPhone = 'شماره تماس الزامی است';
    }
    
    if (!formData.projectAddress.trim()) {
      newErrors.projectAddress = 'آدرس پروژه الزامی است';
    }
    
    if (formData.items.length === 0) {
      newErrors.items = 'حداقل یک قلم باید اضافه شود';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setSaving(true);
    try {
      const updateData = {
        title: formData.title,
        titlePersian: formData.titlePersian,
        contractData: formData,
        totalAmount: formData.totalAmount
      };
      
      console.log('Contract Update Request:', updateData);
      
      const response = await contractsAPI.update(params.id, updateData);

      if (response.data.success) {
        console.log('Contract Update Response:', response.data);
        router.push(`/dashboard/contracts/${params.id}`);
      } else {
        console.error('Contract Update Error:', response.data.error);
        setErrors({ general: response.data.error || 'خطا در به‌روزرسانی قرارداد' });
      }
    } catch (error: any) {
      console.error('Update contract error:', error);
      setErrors({ general: error.response?.data?.error || 'خطا در ارتباط با سرور' });
    } finally {
      setSaving(false);
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
        <Link href={`/dashboard/contracts/${params.id}`} className="glass-liquid-btn p-3">
          <FaArrowRight />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white mb-2">ویرایش قرارداد</h1>
          <p className="text-gray-300">شماره قرارداد: {contract.contractNumber}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-4 py-2 rounded-full text-sm font-medium text-yellow-500 bg-yellow-500/20">
            در حال ویرایش
          </span>
        </div>
      </div>

      {/* Error Messages */}
      {errors.general && (
        <div className="glass-liquid-card p-4 bg-red-500/10 border border-red-500/20">
          <p className="text-red-400">{errors.general}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4">اطلاعات پایه</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-white font-medium mb-2">شماره فرم</label>
              <input
                type="text"
                value={formData.formNumber}
                onChange={(e) => setFormData({ ...formData, formNumber: e.target.value })}
                className="glass-liquid-input w-full"
                placeholder="شماره فرم"
              />
            </div>

            <div>
              <label className="block text-white font-medium mb-2">تاریخ فرم</label>
              <input
                type="text"
                value={formData.formDate}
                onChange={(e) => setFormData({ ...formData, formDate: e.target.value })}
                className="glass-liquid-input w-full"
                placeholder="تاریخ فرم"
              />
            </div>
          </div>
        </div>

        {/* Buyer Information */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4">اطلاعات خریدار</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-white font-medium mb-2">نام و نام خانوادگی خریدار *</label>
              <input
                type="text"
                value={formData.buyerName}
                onChange={(e) => setFormData({ ...formData, buyerName: e.target.value })}
                className="glass-liquid-input w-full"
                placeholder="نام و نام خانوادگی خریدار"
              />
              {errors.buyerName && <p className="text-red-400 text-sm mt-1">{errors.buyerName}</p>}
            </div>

            <div>
              <label className="block text-white font-medium mb-2">کد ملی *</label>
              <input
                type="text"
                value={formData.buyerNationalId}
                onChange={(e) => setFormData({ ...formData, buyerNationalId: e.target.value })}
                className="glass-liquid-input w-full"
                placeholder="کد ملی"
              />
              {errors.buyerNationalId && <p className="text-red-400 text-sm mt-1">{errors.buyerNationalId}</p>}
            </div>

            <div>
              <label className="block text-white font-medium mb-2">شماره تماس *</label>
              <input
                type="text"
                value={formData.buyerPhone}
                onChange={(e) => setFormData({ ...formData, buyerPhone: e.target.value })}
                className="glass-liquid-input w-full"
                placeholder="شماره تماس"
              />
              {errors.buyerPhone && <p className="text-red-400 text-sm mt-1">{errors.buyerPhone}</p>}
            </div>

            <div>
              <label className="block text-white font-medium mb-2">آدرس پروژه *</label>
              <input
                type="text"
                value={formData.projectAddress}
                onChange={(e) => setFormData({ ...formData, projectAddress: e.target.value })}
                className="glass-liquid-input w-full"
                placeholder="آدرس پروژه"
              />
              {errors.projectAddress && <p className="text-red-400 text-sm mt-1">{errors.projectAddress}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="block text-white font-medium mb-2">نحوه تسویه حساب</label>
              <input
                type="text"
                value={formData.paymentMethod}
                onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                className="glass-liquid-input w-full"
                placeholder="نحوه تسویه حساب"
              />
            </div>
          </div>
        </div>

        {/* Product Items Table */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">اقلام قرارداد</h2>
            <button
              type="button"
              onClick={addProductItem}
              className="glass-liquid-btn-primary px-4 py-2 flex items-center gap-2"
            >
              <FaPlus className="h-4 w-4" />
              <span>افزودن قلم</span>
            </button>
          </div>

          {errors.items && <p className="text-red-400 text-sm mb-4">{errors.items}</p>}

          {formData.items.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400 mb-4">هنوز قلمی اضافه نشده است</p>
              <button
                type="button"
                onClick={addProductItem}
                className="glass-liquid-btn-primary"
              >
                افزودن اولین قلم
              </button>
            </div>
          ) : (
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
                    <th className="text-right text-white p-3">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {formData.items.map((item, index) => (
                    <tr key={item.id} className="border-b border-gray-700/50">
                      <td className="p-3 text-gray-300">{index + 1}</td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={item.code}
                          onChange={(e) => updateProductItem(item.id, 'code', e.target.value)}
                          className="glass-liquid-input w-20 text-sm"
                          placeholder="کد"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={item.stoneType}
                          onChange={(e) => updateProductItem(item.id, 'stoneType', e.target.value)}
                          className="glass-liquid-input w-24 text-sm"
                          placeholder="نوع سنگ"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={item.thickness}
                          onChange={(e) => updateProductItem(item.id, 'thickness', e.target.value)}
                          className="glass-liquid-input w-20 text-sm"
                          placeholder="قطر"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.length}
                          onChange={(e) => updateProductItem(item.id, 'length', parseFloat(e.target.value) || 0)}
                          className="glass-liquid-input w-20 text-sm"
                          placeholder="طول"
                          step="0.01"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.width}
                          onChange={(e) => updateProductItem(item.id, 'width', parseFloat(e.target.value) || 0)}
                          className="glass-liquid-input w-20 text-sm"
                          placeholder="عرض"
                          step="0.01"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateProductItem(item.id, 'quantity', parseInt(e.target.value) || 0)}
                          className="glass-liquid-input w-20 text-sm"
                          placeholder="تعداد"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.squareMeter}
                          onChange={(e) => updateProductItem(item.id, 'squareMeter', parseFloat(e.target.value) || 0)}
                          className="glass-liquid-input w-20 text-sm"
                          placeholder="متر مربع"
                          step="0.01"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateProductItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="glass-liquid-input w-24 text-sm"
                          placeholder="فی"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.totalPrice}
                          onChange={(e) => updateProductItem(item.id, 'totalPrice', parseFloat(e.target.value) || 0)}
                          className="glass-liquid-input w-24 text-sm"
                          placeholder="قیمت کل"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateProductItem(item.id, 'description', e.target.value)}
                          className="glass-liquid-input w-32 text-sm"
                          placeholder="توضیحات"
                        />
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => removeProductItem(item.id)}
                          className="glass-liquid-btn p-2 text-red-400"
                        >
                          <FaTrash className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Contract Summary */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4">خلاصه قرارداد</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-white font-medium mb-2">مبلغ کل (ریال)</label>
              <input
                type="number"
                value={formData.totalAmount}
                onChange={(e) => setFormData({ ...formData, totalAmount: parseFloat(e.target.value) || 0 })}
                className="glass-liquid-input w-full"
                placeholder="مبلغ کل"
                readOnly
              />
            </div>
            
            <div>
              <label className="block text-white font-medium mb-2">مبلغ کل به حروف</label>
              <input
                type="text"
                value={formData.totalAmountWords}
                className="glass-liquid-input w-full"
                placeholder="مبلغ کل به حروف"
                readOnly
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-4">
          <Link href={`/dashboard/contracts/${params.id}`} className="glass-liquid-btn px-6 py-3">
            انصراف
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="glass-liquid-btn-primary px-6 py-3 flex items-center gap-2 disabled:opacity-50"
          >
            <FaSave className="h-4 w-4" />
            {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </button>
        </div>
      </form>
    </div>
  );
}

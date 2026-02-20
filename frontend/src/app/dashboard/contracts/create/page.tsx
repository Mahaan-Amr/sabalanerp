'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  FaArrowRight, 
  FaSave, 
  FaEye, 
  FaUser, 
  FaBuilding, 
  FaFileContract,
  FaPlus,
  FaTrash,
  FaCalculator
} from 'react-icons/fa';
import { contractTemplatesAPI, customersAPI, departmentsAPI, contractsAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

interface Department {
  id: string;
  name: string;
  namePersian: string;
}

interface ContractTemplate {
  id: string;
  name: string;
  namePersian: string;
  description: string | null;
  variables: any;
  structure: any;
  calculations: any;
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

export default function CreateContractPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('template');
  const hasTemplate = Boolean(templateId);

  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [nextContractNumber, setNextContractNumber] = useState<string>('');
  const [step, setStep] = useState<number>(0);
  // One-field-per-step sequence
  const fieldSteps: Array<
    | { key: 'formNumber' | 'formDate' | 'buyerName' | 'buyerNationalId' | 'buyerPhone' | 'projectAddress' | 'paymentMethod'; label: string; type: 'text' | 'readonly' }
    | { key: 'customerId' | 'departmentId'; label: string; type: 'select' }
    | { key: 'items'; label: string; type: 'items' }
    | { key: 'summary'; label: string; type: 'summary' }
  > = [
    { key: 'formNumber', label: 'شماره فرم', type: 'readonly' },
    { key: 'formDate', label: 'تاریخ فرم', type: 'text' },
    { key: 'customerId', label: 'مشتری', type: 'select' },
    { key: 'departmentId', label: 'بخش', type: 'select' },
    { key: 'buyerName', label: 'نام و نام Ø®Ø§Ù†Ùˆادگی خریدار', type: 'text' },
    { key: 'buyerNationalId', label: 'کد ملی', type: 'text' },
    { key: 'buyerPhone', label: 'شماره تماس', type: 'text' },
    { key: 'projectAddress', label: 'آدرس Ù¾Ø±ÙˆÚ˜ه', type: 'text' },
    { key: 'paymentMethod', label: 'Ù†Ø­Ùˆه ØªØ³Ùˆیه حساب', type: 'text' },
    { key: 'items', label: 'Ø§ÙØ²Ùˆدن اقلام', type: 'items' },
    { key: 'summary', label: 'خلاصه و ایجاد', type: 'summary' },
  ];

  // Item mini-wizard
  const [itemStep, setItemStep] = useState<number>(0);
  const itemFields: Array<{ key: keyof ProductItem; label: string; type: 'text' | 'number' }> = [
    { key: 'code', label: 'کد', type: 'text' },
    { key: 'stoneType', label: 'Ù†Ùˆع سنگ', type: 'text' },
    { key: 'thickness', label: '�طر', type: 'text' },
    { key: 'length', label: 'Ø·Ùˆل', type: 'number' },
    { key: 'width', label: 'عرض', type: 'number' },
    { key: 'quantity', label: 'تعداد', type: 'number' },
    { key: 'squareMeter', label: 'متر مربع', type: 'number' },
    { key: 'unitPrice', label: 'ف�R', type: 'number' },
    { key: 'totalPrice', label: 'قیمت کل', type: 'number' },
    { key: 'description', label: 'ØªÙˆضیحات', type: 'text' },
  ];
  const [draftItem, setDraftItem] = useState<ProductItem>({
    id: '', code: '', stoneType: '', thickness: '', length: 0, width: 0, quantity: 0,
    squareMeter: 0, unitPrice: 0, totalPrice: 0, description: ''
  });

  // Contract data structure matching the Soblan Stone form
  const [contractData, setContractData] = useState({
    // Basic contract info
    title: 'قرارداد ÙØ±Ùˆش سبلان Ø§Ø³ØªÙˆن',
    titlePersian: 'قرارداد ÙØ±Ùˆش سبلان Ø§Ø³ØªÙˆن',
    customerId: '',
    departmentId: '',
    templateId: templateId || '',
    
    // Form number and date
    formNumber: '',
    formDate: PersianCalendar.now(),
    
    // Buyer information (from the paper form)
    buyerName: '',
    buyerNationalId: '',
    buyerPhone: '',
    projectAddress: '',
    
    // Contract details
    contractDate: PersianCalendar.now(),
    paymentMethod: '',
    
    // Product items
    items: [] as ProductItem[],
    
    // Calculated totals
    totalAmount: 0,
    totalAmountWords: ''
  });

  useEffect(() => {
    if (templateId) {
      fetchTemplate();
    } else {
      // No template selected: allow the page to render, but mark template as a lightweight default
      setTemplate({
        id: '',
        name: 'Standard Contract',
        namePersian: 'قرارداد ÙØ±Ùˆش استاندارد',
        description: null,
        variables: null,
        structure: null,
        calculations: null,
      });
    }
    fetchCustomers();
    fetchDepartments();
    fetchNextNumber();
  }, [templateId]);

  const fetchNextNumber = async () => {
    try {
      const response = await contractsAPI.getAll({ limit: 1 });
      if (response.data.success) {
        const last = response.data.data[0];
        const extractNumeric = (value: string | null | undefined): number | null => {
          if (!value) return null;
          const pure = value.match(/^\d+$/);
          if (pure) return parseInt(pure[0], 10);
          const m = value.match(/(\d+)/);
          return m ? parseInt(m[1], 10) : null;
        };
        const lastNum = extractNumeric(last?.contractNumber) ?? 999;
        const next = Math.max(1000, lastNum + 1);
        setNextContractNumber(String(next));
      }
    } catch (e) {
      // If it fails, fallback to 1000
      setNextContractNumber('1000');
    }
  };

  const fetchTemplate = async () => {
    try {
      const response = await contractTemplatesAPI.getById(templateId!);
      if (response.data.success) {
        setTemplate(response.data.data);
        setContractData(prev => ({
          ...prev,
          templateId: templateId!,
          title: response.data.data.namePersian,
          titlePersian: response.data.data.namePersian
        }));
      }
    } catch (error) {
      console.error('Error fetching template:', error);
    }
  };

  const fetchCustomers = async () => {
    try {
      const response = await customersAPI.getAll();
      if (response.data.success) {
        setCustomers(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await departmentsAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const addProductItem = () => {
    const newItem: ProductItem = {
      id: Date.now().toString(),
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
    
    setContractData(prev => ({
      ...prev,
      items: [...prev.items, newItem]
    }));
  };
    
  const removeProductItem = (itemId: string) => {
    setContractData(prev => ({
        ...prev,
      items: prev.items.filter(item => item.id !== itemId)
    }));
  };

  const updateProductItem = (itemId: string, field: keyof ProductItem, value: any) => {
    setContractData(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.id === itemId) {
          const updatedItem = { ...item, [field]: value };
          
          // Auto-calculate square meter only if length and width are provided
          if (field === 'length' || field === 'width') {
            if (updatedItem.length > 0 && updatedItem.width > 0) {
              updatedItem.squareMeter = updatedItem.length * updatedItem.width;
            }
          }
          
          // Auto-calculate total price only if square meter and unit price are provided
          if (field === 'squareMeter' || field === 'unitPrice') {
            if (updatedItem.squareMeter > 0 && updatedItem.unitPrice > 0) {
              updatedItem.totalPrice = updatedItem.squareMeter * updatedItem.unitPrice;
            }
          }
          
          return updatedItem;
        }
        return item;
      })
    }));
  };

  const calculateTotals = () => {
    const totalAmount = contractData.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const totalAmountWords = convertToPersianWords(totalAmount);
    
    setContractData(prev => ({
        ...prev,
      totalAmount,
      totalAmountWords
    }));
  };

  const convertToPersianWords = (num: number): string => {
    // Simplified Persian number conversion
    const persianNumbers = ['صفر', 'ÛŒÚ©', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
    
    if (num === 0) return 'صفر';
    if (num < 10) return persianNumbers[num];
    
    // For larger numbers, return formatted number
    return num.toLocaleString('fa-IR') + ' ریال';
  };

  useEffect(() => {
    calculateTotals();
  }, [contractData.items]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    // Basic fields are now optional - no validation required
    // Only validate essential fields for contract generation
    if (!contractData.buyerName.trim()) {
      newErrors.buyerName = 'نام خریدار الزامی است';
    }
    if (!contractData.buyerNationalId.trim()) {
      newErrors.buyerNationalId = 'کد ملی الزامی است';
    }
    if (!contractData.buyerPhone.trim()) {
      newErrors.buyerPhone = 'شماره تماس الزامی است';
    }
    if (!contractData.projectAddress.trim()) {
      newErrors.projectAddress = 'آدرس Ù¾Ø±ÙˆÚ˜ه الزامی است';
    }
    if (contractData.items.length === 0) {
      newErrors.items = 'حداقل ÛŒÚ© قلم Ù…Ø­ØµÙˆل الزامی است';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      return;
    }

    if (!hasTemplate) {
      setErrors({ general: 'لطفا ابتدا ÛŒÚ© قالب قرارداد انتخاب کنید.' });
      return;
    }

    setLoading(true);
    try {
      const requestData = {
        customerId: contractData.customerId,
        departmentId: contractData.departmentId,
        contractData: { ...contractData, contractNumber: nextContractNumber },
        title: contractData.title,
        titlePersian: contractData.titlePersian
      };
      
      console.log('Contract Creation Request:', requestData);
      console.log('Contract Data:', contractData);
      
      const response = await contractTemplatesAPI.generateContract(templateId!, requestData);

      if (response.data.success) {
        console.log('Contract Creation Response:', response.data);
        router.push('/dashboard/contracts');
      } else {
        console.error('Contract Creation Error:', response.data.error);
        setErrors({ general: response.data.error || 'خطا در ایجاد قرارداد' });
      }
    } catch (error: any) {
      console.error('Create contract error:', error);
      setErrors({ general: error.response?.data?.error || 'خطا در ارتباط با سرور' });
    } finally {
      setLoading(false);
    }
  };

  if (hasTemplate && !template) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  // Wizard helpers
  const current = fieldSteps[step];
  const goPrev = () => setStep((s) => Math.max(0, s - 1));
  const goNext = () => {
    const errs: Record<string, string> = {};
    if (current.key === 'buyerName' && !contractData.buyerName.trim()) errs.buyerName = 'نام خریدار الزامی است';
    if (current.key === 'buyerNationalId' && !contractData.buyerNationalId.trim()) errs.buyerNationalId = 'کد ملی الزامی است';
    if (current.key === 'buyerPhone' && !contractData.buyerPhone.trim()) errs.buyerPhone = 'شماره تماس الزامی است';
    if (current.key === 'projectAddress' && !contractData.projectAddress.trim()) errs.projectAddress = 'آدرس Ù¾Ø±ÙˆÚ˜ه الزامی است';
    if (current.key === 'items' && contractData.items.length === 0) errs.items = 'حداقل ÛŒÚ© قلم باید ثبت Ø´Ùˆد';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setStep((s) => Math.min(s + 1, fieldSteps.length - 1));
  };

  const renderSingleField = () => {
    switch (current.type) {
      case 'readonly':
        return (
          <div>
            <label className="block text-white font-medium mb-2">{current.label}</label>
            <input type="text" className="glass-liquid-input w-full opacity-80 cursor-not-allowed" readOnly value={nextContractNumber || 'در حال محاسبه...'} />
          </div>
        );
      case 'text':
        return (
          <div>
            <label className="block text-white font-medium mb-2">{current.label}</label>
            <input type="text" className="glass-liquid-input w-full" value={(contractData as any)[current.key]} onChange={(e) => setContractData({ ...contractData, [current.key]: e.target.value })} placeholder={current.label} />
            {errors[current.key] && <p className="text-red-400 text-sm mt-1">{errors[current.key]}</p>}
          </div>
        );
      case 'select':
        if (current.key === 'customerId') {
          return (
            <div>
              <label className="block text-white font-medium mb-2">{current.label}</label>
              <select className="glass-liquid-input w-full" value={contractData.customerId} onChange={(e) => setContractData({ ...contractData, customerId: e.target.value })}>
                <option value="">انتخاب مشتری (اختیاری)</option>
                {customers.map(c => (<option key={c.id} value={c.id}>{c.firstName} {c.lastName} {c.companyName && `(${c.companyName})`}</option>))}
              </select>
            </div>
          );
        }
        return (
          <div>
            <label className="block text-white font-medium mb-2">{current.label}</label>
            <select className="glass-liquid-input w-full" value={contractData.departmentId} onChange={(e) => setContractData({ ...contractData, departmentId: e.target.value })}>
              <option value="">انتخاب بخش (اختیاری)</option>
              {departments.map(d => (<option key={d.id} value={d.id}>{d.namePersian}</option>))}
            </select>
          </div>
        );
      case 'items':
  return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
                <label className="block text-white font-medium mb-2">کد</label>
                <input type="text" className="glass-liquid-input w-full" value={draftItem.code} onChange={(e)=>setDraftItem({ ...draftItem, code: e.target.value })} placeholder="کد" />
            </div>
              <div>
                <label className="block text-white font-medium mb-2">Ù†Ùˆع سنگ</label>
                <input type="text" className="glass-liquid-input w-full" value={draftItem.stoneType} onChange={(e)=>setDraftItem({ ...draftItem, stoneType: e.target.value })} placeholder="Ù†Ùˆع سنگ" />
          </div>
              <div>
                <label className="block text-white font-medium mb-2">�طر</label>
                <input type="text" className="glass-liquid-input w-full" value={draftItem.thickness} onChange={(e)=>setDraftItem({ ...draftItem, thickness: e.target.value })} placeholder="�طر" />
        </div>
              <div>
                <label className="block text-white font-medium mb-2">Ø·Ùˆل</label>
                <input type="number" className="glass-liquid-input w-full" value={draftItem.length} onChange={(e)=>{
                  const val = parseFloat(e.target.value) || 0; const nxt = { ...draftItem, length: val, squareMeter: val * (draftItem.width || 0) };
                  nxt.totalPrice = (nxt.squareMeter || 0) * (nxt.unitPrice || 0); setDraftItem(nxt);
                }} placeholder="Ø·Ùˆل" />
              </div>
              <div>
                <label className="block text-white font-medium mb-2">عرض</label>
                <input type="number" className="glass-liquid-input w-full" value={draftItem.width} onChange={(e)=>{
                  const val = parseFloat(e.target.value) || 0; const nxt = { ...draftItem, width: val, squareMeter: (draftItem.length || 0) * val };
                  nxt.totalPrice = (nxt.squareMeter || 0) * (nxt.unitPrice || 0); setDraftItem(nxt);
                }} placeholder="عرض" />
              </div>
              <div>
                <label className="block text-white font-medium mb-2">تعداد</label>
                <input type="number" className="glass-liquid-input w-full" value={draftItem.quantity} onChange={(e)=>setDraftItem({ ...draftItem, quantity: parseInt(e.target.value) || 0 })} placeholder="تعداد" />
              </div>
              <div>
                <label className="block text-white font-medium mb-2">متر مربع</label>
                <input type="number" step="0.01" className="glass-liquid-input w-full" value={draftItem.squareMeter} onChange={(e)=>{
                  const val = parseFloat(e.target.value) || 0; const nxt = { ...draftItem, squareMeter: val } as ProductItem;
                  nxt.totalPrice = (val || 0) * (nxt.unitPrice || 0); setDraftItem(nxt);
                }} placeholder="متر مربع" />
              </div>
              <div>
                <label className="block text-white font-medium mb-2">ف�R</label>
                <input type="number" className="glass-liquid-input w-full" value={draftItem.unitPrice} onChange={(e)=>{
                  const val = parseFloat(e.target.value) || 0; const nxt = { ...draftItem, unitPrice: val } as ProductItem;
                  nxt.totalPrice = (nxt.squareMeter || 0) * (val || 0); setDraftItem(nxt);
                }} placeholder="قیمت Ùˆاحد" />
              </div>
              <div>
                <label className="block text-white font-medium mb-2">قیمت کل</label>
                <div className="flex items-center gap-2">
                  <input type="number" className="glass-liquid-input w-full" value={draftItem.totalPrice} onChange={(e)=>setDraftItem({ ...draftItem, totalPrice: parseFloat(e.target.value) || 0 })} placeholder="قیمت کل" />
                  <span className="text-xs text-gray-400">ریال</span>
                </div>
              </div>
              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-white font-medium mb-2">ØªÙˆضیحات</label>
                <input type="text" className="glass-liquid-input w-full" value={draftItem.description} onChange={(e)=>setDraftItem({ ...draftItem, description: e.target.value })} placeholder="ØªÙˆضیحات" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <button type="button" className="glass-liquid-btn px-6 py-3" onClick={goPrev}>قبلی</button>
              <div className="flex items-center gap-2">
                <button type="button" className="glass-liquid-btn-primary px-6 py-3" onClick={()=>{
                  const newItem = { ...draftItem, id: `item-${Date.now()}` } as ProductItem;
                  setContractData(prev => ({ ...prev, items: [...prev.items, newItem] }));
                  setDraftItem({ id:'', code:'', stoneType:'', thickness:'', length:0, width:0, quantity:0, squareMeter:0, unitPrice:0, totalPrice:0, description:'' });
                }}>ذخیره قلم و Ø§ÙØ²Ùˆدن بعدی</button>
                <button type="button" className="glass-liquid-btn px-6 py-3" onClick={()=>{
                  if (draftItem.code || draftItem.squareMeter || draftItem.unitPrice || draftItem.totalPrice) {
                    const newItem = { ...draftItem, id: `item-${Date.now()}` } as ProductItem;
                    setContractData(prev => ({ ...prev, items: [...prev.items, newItem] }));
                    setDraftItem({ id:'', code:'', stoneType:'', thickness:'', length:0, width:0, quantity:0, squareMeter:0, unitPrice:0, totalPrice:0, description:'' });
                  }
                  setStep((s)=>s+1);
                }}>ادامه</button>
                </div>
              </div>
            {contractData.items.length>0 && <div className="text-gray-300 text-sm">اقلام ثبت‌شده: {contractData.items.length} قلم</div>}
            {errors.items && <p className="text-red-400 text-sm">{errors.items}</p>}
          </div>
        );
      case 'summary':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 glass-liquid-card p-6 text-sm text-gray-300">
              <div>شماره فرم: <span className="text-white font-mono">{nextContractNumber}</span></div>
              <div>تاریخ فرم: <span className="text-white">{contractData.formDate}</span></div>
              <div>نام خریدار: <span className="text-white">{contractData.buyerName || '—'}</span></div>
              <div>کد ملی: <span className="text-white">{contractData.buyerNationalId || '—'}</span></div>
              <div>تلفن: <span className="text-white">{contractData.buyerPhone || '—'}</span></div>
              <div>آدرس: <span className="text-white">{contractData.projectAddress || '�'}</span></div>
              <div>Ù†Ø­Ùˆه ØªØ³Ùˆیه: <span className="text-white">{contractData.paymentMethod || '—'}</span></div>
              <div className="md:col-span-2">تعداد اقلام: <span className="text-white">{contractData.items.length}</span></div>
              <div className="md:col-span-2">مبلغ کل: <span className="text-teal-400 font-semibold">{contractData.totalAmount.toLocaleString('fa-IR')} ریال</span></div>
            </div>
            <div className="flex items-center justify-end gap-4">
              <button type="button" onClick={goPrev} className="glass-liquid-btn px-6 py-3">قبلی</button>
              <button type="button" onClick={handleSubmit as any} disabled={loading} className="glass-liquid-btn-primary px-8 py-3">{loading ? 'در حال ایجاد...' : 'ایجاد قرارداد'}</button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
            <div>
          <h1 className="text-2xl font-bold text-white">ایجاد قرارداد جدید</h1>
          {template && (<p className="text-teal-400 text-sm mt-1">قالب: {template.namePersian}</p>)}
        </div>
        <Link href="/dashboard/contracts" className="glass-liquid-btn px-6 py-3 flex items-center gap-2"><FaArrowRight className="h-5 w-5" /><span>بازگشت</span></Link>
            </div>

      {/* Progress */}
      <div className="glass-liquid-card p-4">
        <div className="text-gray-300 text-sm mb-2">گا�& {step + 1} از {fieldSteps.length}: {current.label}</div>
        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-teal-500" style={{ width: `${((step + 1) / fieldSteps.length) * 100}%` }} />
            </div>
          </div>

      {errors.general && (<div className="glass-liquid-card p-4 bg-red-500/10 border border-red-500/20"><p className="text-red-400">{errors.general}</p></div>)}

      <div className="glass-liquid-card p-6">
        {renderSingleField()}
        {current.type !== 'items' && current.type !== 'summary' && (
          <div className="flex items-center justify-between mt-6">
            <button type="button" className="glass-liquid-btn px-6 py-3" onClick={goPrev} disabled={step===0}>قبلی</button>
            <button type="button" className="glass-liquid-btn-primary px-6 py-3 min-w-[110px]" onClick={goNext}>بعد�R</button>
          </div>
        )}
      </div>
    </div>
  );
}

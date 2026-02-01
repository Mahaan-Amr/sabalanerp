'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { 
  FaArrowRight, 
  FaSave,
  FaTimes,
  FaFileContract,
  FaUser,
  FaBuilding,
  FaDollarSign,
  FaEdit,
  FaCalendarAlt,
  FaWarehouse,
  FaTruck,
  FaCreditCard,
  FaCheck,
  FaPlus,
  FaTrash
} from 'react-icons/fa';
import { salesAPI, dashboardAPI, crmAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';

// Types from contract creation wizard
interface CrmCustomer {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  customerType: string;
  status: string;
  projectAddresses: ProjectAddress[];
  phoneNumbers: PhoneNumber[];
  nationalCode?: string;
  homeAddress?: string;
  homeNumber?: string;
  workAddress?: string;
  workNumber?: string;
  projectManagerName?: string;
  projectManagerNumber?: string;
  brandName?: string;
  brandNameDescription?: string;
  isBlacklisted: boolean;
  isLocked: boolean;
}

interface ProjectAddress {
  id: string;
  address: string;
  city: string;
  postalCode?: string;
  projectName?: string;
  projectType?: string;
}

interface PhoneNumber {
  id: string;
  number: string;
  type: string;
  isPrimary: boolean;
}

interface Product {
  id: string;
  name: string;
  namePersian: string;
  stoneTypeNamePersian: string;
  widthValue: number;
  thicknessValue: number;
  basePrice: number;
  currency: string;
}

interface ContractProduct {
  productId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
  description: string;
}

interface DeliverySchedule {
  deliveryDate: string;
  deliveryAddress: string;
  driver: string;
  vehicle: string;
  notes: string;
  products: ContractProduct[];
}

interface PaymentInstallment {
  installmentNumber: number;
  amount: number;
  dueDate: string;
  notes?: string;
}

interface PaymentMethod {
  method: 'CASH' | 'RECEIPT_BASE' | 'CHECK';
  totalAmount: number;
  currency: string;
  nationalCode?: string;
  notes?: string;
  installments: PaymentInstallment[];
}

interface ContractWizardData {
  contractDate: string;
  contractNumber: string;
  customerId: string;
  customer: CrmCustomer | null;
  projectId: string;
  project: ProjectAddress | null;
  products: ContractProduct[];
  deliveries: DeliverySchedule[];
  payment: PaymentMethod;
}

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
  contractData?: ContractWizardData;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
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
}

interface User {
  id: string;
  role: string;
  departmentId?: string;
}

export default function ContractEditPage() {
  const params = useParams();
  const router = useRouter();
  const contractId = params.id as string;
  
  const [contract, setContract] = useState<Contract | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Wizard data state
  const [wizardData, setWizardData] = useState<ContractWizardData>({
    contractDate: '',
    contractNumber: '',
    customerId: '',
    customer: null,
    projectId: '',
    project: null,
    products: [],
    deliveries: [],
    payment: {
      method: 'CASH',
      totalAmount: 0,
      currency: 'تومان',
      nationalCode: '',
      notes: '',
      installments: []
    }
  });
  
  // Additional data for editing
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [userDepartment, setUserDepartment] = useState<string | null>(null);
  
  // Form data for basic fields
  const [formData, setFormData] = useState({
    title: '',
    titlePersian: '',
    content: '',
    totalAmount: '',
    currency: 'ریال',
    notes: ''
  });

  useEffect(() => {
    loadInitialData();
  }, [contractId]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      
      // Load contract data
      const contractResponse = await salesAPI.getContract(contractId);
      if (contractResponse.data.success) {
        const contractData = contractResponse.data.data;
        setContract(contractData);
        
        // Set basic form data
        setFormData({
          title: contractData.title || '',
          titlePersian: contractData.titlePersian || '',
          content: contractData.content || '',
          totalAmount: contractData.totalAmount?.toString() || '',
          currency: contractData.currency || 'تومان',
          notes: contractData.notes || ''
        });
        
        // Set wizard data from contractData
        if (contractData.contractData) {
          setWizardData(contractData.contractData);
        }
      } else {
        setError('قرارداد یافت نشد');
        return;
      }
      
      // Load current user
      const userResponse = await dashboardAPI.getProfile();
      if (userResponse.data.success) {
        setCurrentUser(userResponse.data.data);
        setUserDepartment(userResponse.data.data.departmentId);
      }
      
      // Load customers from CRM
      const customersResponse = await crmAPI.getCustomers();
      if (customersResponse.data.success) {
        setCustomers(customersResponse.data.data);
      }
      
      // Load products from Sales
      const productsResponse = await salesAPI.getProducts();
      if (productsResponse.data.success) {
        setProducts(productsResponse.data.data);
      }
      
      // Load departments
      const departmentsResponse = await salesAPI.getDepartments();
      if (departmentsResponse.data.success) {
        setDepartments(departmentsResponse.data.data);
      }
      
    } catch (error: any) {
      console.error('Error loading initial data:', error);
      setError(error.response?.data?.error || 'خطا در بارگذاری اطلاعات');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const updateWizardData = (updates: Partial<ContractWizardData>) => {
    setWizardData(prev => {
      const newData = { ...prev, ...updates };
      console.log('Updated wizardData:', newData);
      return newData;
    });
  };

  const generateContractHTML = (data: ContractWizardData) => {
    const productsTable = data.products && data.products.length > 0 ? `
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr style="background-color: #f5f5f5;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">نام محصول</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">ابعاد</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">تعداد</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">متر مربع</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">فی</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">قیمت کل</th>
          </tr>
        </thead>
        <tbody>
          ${data.products.map((product: any) => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.namePersian || product.product?.name || product.namePersian || product.name || 'نامشخص'}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.widthValue && product.product?.thicknessValue ? `${product.product.widthValue} × ${product.product.thicknessValue}` : product.length && product.width ? `${product.length} × ${product.width}` : 'نامشخص'}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${product.quantity || 0}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.squareMeter || product.squareMeter || 'نامشخص'}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${product.unitPrice ? `${product.unitPrice.toLocaleString('fa-IR')} ریال` : 'نامشخص'}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${product.totalPrice ? `${product.totalPrice.toLocaleString('fa-IR')} ریال` : 'نامشخص'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    const deliveriesSection = data.deliveries && data.deliveries.length > 0 ? `
      <h3>برنامه تحویل:</h3>
      <ul>
        ${data.deliveries.map((delivery: any) => `
          <li>تاریخ: ${delivery.deliveryDate} - ${delivery.notes || 'بدون توضیحات'}</li>
        `).join('')}
      </ul>
    ` : '';

    return `
      <div style="font-family: 'Tahoma', sans-serif; direction: rtl; text-align: right;">
        <h1 style="text-align: center; color: #333;">قرارداد فروش سبلان استون</h1>

        <div style="margin: 20px 0;">
          <p><strong>شماره قرارداد:</strong> ${data.contractNumber}</p>
          <p><strong>تاریخ قرارداد:</strong> ${data.contractDate}</p>
        </div>

        <div style="margin: 20px 0;">
          <h3>اطلاعات مشتری:</h3>
          <p><strong>نام:</strong> ${data.customer?.firstName} ${data.customer?.lastName}</p>
          ${data.customer?.companyName ? `<p><strong>نام شرکت:</strong> ${data.customer.companyName}</p>` : ''}
          ${data.customer?.phoneNumbers && data.customer.phoneNumbers.length > 0 ? `<p><strong>شماره تماس:</strong> ${data.customer.phoneNumbers[0].number}</p>` : ''}
        </div>

        ${data.project ? `
          <div style="margin: 20px 0;">
            <h3>اطلاعات پروژه:</h3>
            <p><strong>آدرس پروژه:</strong> ${data.project.address || 'نامشخص'}</p>
            <p><strong>نام پروژه:</strong> ${data.project.projectName || 'نامشخص'}</p>
          </div>
        ` : ''}

        <div style="margin: 20px 0;">
          <h3>اقلام قرارداد:</h3>
          ${productsTable}
        </div>

        ${data.payment ? `
          <div style="margin: 20px 0;">
            <h3>اطلاعات پرداخت:</h3>
            <p><strong>نحوه پرداخت:</strong> ${data.payment.method}</p>
            <p><strong>مبلغ کل:</strong> ${data.payment.totalAmount?.toLocaleString('fa-IR')} ریال</p>
          </div>
        ` : ''}

        ${deliveriesSection}

        <div style="margin-top: 40px; text-align: center;">
          <p>این قرارداد در تاریخ ${data.contractDate} منعقد شده است.</p>
        </div>
      </div>
    `;
  };

  const handleSave = async () => {
    if (!contract) return;
    
    setSaving(true);
    setError(null);
    
    try {
      // Calculate total amount from products
      const totalAmount = wizardData.products.reduce((sum, product) => sum + product.totalPrice, 0);
      
      // Generate updated HTML content
      const updatedContent = generateContractHTML(wizardData);
      
      const updateData = {
        ...formData,
        totalAmount: formData.totalAmount ? parseFloat(formData.totalAmount) : totalAmount,
        content: updatedContent,
        contractData: wizardData
      };
      
      const response = await salesAPI.updateContract(contract.id, updateData);
      
      if (response.data.success) {
        router.push(`/dashboard/sales/contracts/${contract.id}`);
      } else {
        setError(response.data.error || 'خطا در ذخیره تغییرات');
      }
    } catch (error: any) {
      console.error('Error updating contract:', error);
      setError(error.response?.data?.error || 'خطا در ذخیره تغییرات');
    } finally {
      setSaving(false);
    }
  };

  const canEdit = contract && contract.status === 'DRAFT' && 
    (currentUser?.role === 'ADMIN' || contract.createdByUser.id === currentUser?.id);

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

  if (!canEdit) {
    return (
      <div className="text-center py-12">
        <FaFileContract className="mx-auto text-4xl text-gray-400 mb-4" />
        <p className="text-gray-400 mb-4">شما مجاز به ویرایش این قرارداد نیستید</p>
        <Link href={`/dashboard/sales/contracts/${contract.id}`} className="glass-liquid-btn-primary">
          مشاهده قرارداد
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/dashboard/sales/contracts/${contract.id}`} className="glass-liquid-btn p-3">
          <FaArrowRight />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
            <FaEdit className="text-teal-400" />
            ویرایش قرارداد
          </h1>
          <p className="text-gray-300">شماره قرارداد: {contract.contractNumber}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/dashboard/sales/contracts/${contract.id}`)}
            className="glass-liquid-btn p-3 text-gray-400 hover:text-white"
          >
            <FaTimes />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="glass-liquid-btn-primary p-3 disabled:opacity-50"
          >
            {saving ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <FaSave />
            )}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="glass-liquid-card p-4 border border-red-500/50 bg-red-500/10">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Comprehensive Edit Form */}
      <div className="space-y-6">
        {/* Step 1: Contract Date & Number */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <FaCalendarAlt className="text-teal-400" />
            تاریخ و شماره قرارداد
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">تاریخ قرارداد</label>
              <PersianCalendarComponent
                value={wizardData.contractDate}
                onChange={(date: string) => updateWizardData({ contractDate: date })}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">شماره قرارداد</label>
              <input
                type="text"
                value={wizardData.contractNumber}
                readOnly
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Step 2: Customer Selection */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <FaUser className="text-teal-400" />
            انتخاب مشتری
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customers.map((customer) => (
                <div
                  key={customer.id}
                  onClick={() => updateWizardData({ 
                    customerId: customer.id, 
                    customer: customer 
                  })}
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    wizardData.customerId === customer.id
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-800 dark:text-white">
                        {customer.firstName} {customer.lastName}
                      </h4>
                      {customer.companyName && (
                        <p className="text-sm text-gray-600 dark:text-gray-300">{customer.companyName}</p>
                      )}
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {customer.customerType} • {customer.status}
                      </p>
                    </div>
                    {wizardData.customerId === customer.id && (
                      <FaCheck className="text-teal-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Step 3: Project Selection */}
        {wizardData.customer && (
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <FaBuilding className="text-teal-400" />
              انتخاب پروژه
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {wizardData.customer.projectAddresses.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => updateWizardData({ 
                      projectId: project.id, 
                      project: project 
                    })}
                    className={`p-4 border rounded-lg cursor-pointer transition-all ${
                      wizardData.projectId === project.id
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium text-gray-800 dark:text-white">
                          {project.projectName || 'پروژه بدون نام'}
                        </h4>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{project.address}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{project.city}</p>
                      </div>
                      {wizardData.projectId === project.id && (
                        <FaCheck className="text-teal-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Product Selection */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <FaWarehouse className="text-teal-400" />
            انتخاب محصولات
          </h2>
          <div className="space-y-6">
            {/* Available Products */}
            <div>
              <h3 className="text-lg font-medium text-white mb-4">محصولات موجود</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="group p-6 border border-gray-200 dark:border-gray-600 rounded-xl hover:border-teal-300 dark:hover:border-teal-500 transition-all duration-300 hover:shadow-lg hover:shadow-teal-500/10 bg-white dark:bg-gray-800/50 backdrop-blur-sm"
                  >
                    <div className="mb-4">
                      <h4 className="font-semibold text-gray-800 dark:text-white mb-2 text-lg">
                        {product.namePersian}
                      </h4>
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          {product.stoneTypeNamePersian}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {product.widthValue}×{product.thicknessValue}cm
                        </p>
                      </div>
                    </div>
                    
                    {product.basePrice && (
                      <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
                        <p className="text-lg font-bold text-teal-600 dark:text-teal-400">
                          {product.basePrice.toLocaleString()} {product.currency}
                        </p>
                      </div>
                    )}
                    
                    <button
                      onClick={() => {
                        const newProduct: ContractProduct = {
                          productId: product.id,
                          product: product,
                          quantity: 1,
                          unitPrice: product.basePrice || 0,
                          totalPrice: product.basePrice || 0,
                          currency: product.currency,
                          description: ''
                        };
                        updateWizardData({
                          products: [...wizardData.products, newProduct]
                        });
                      }}
                      className="w-full px-4 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg hover:from-teal-600 hover:to-teal-700 transition-all duration-300 transform hover:scale-105 hover:shadow-lg hover:shadow-teal-500/25 font-medium"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <FaPlus className="w-4 h-4" />
                        افزودن به قرارداد
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Selected Products */}
            {wizardData.products.length > 0 && (
              <div className="p-6 bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-900/20 dark:to-teal-800/20 rounded-xl border border-teal-200 dark:border-teal-800">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center">
                    <FaCheck className="w-4 h-4 text-white" />
                  </div>
                  <h4 className="font-semibold text-gray-800 dark:text-white text-lg">محصولات انتخاب شده</h4>
                  <span className="bg-teal-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                    {wizardData.products.length} محصول
                  </span>
                </div>
                <div className="space-y-3">
                  {wizardData.products.map((product, index) => (
                    <div key={index} className="flex justify-between items-center p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 shadow-sm">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-800 dark:text-white">
                          {product.product.namePersian}
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {product.product.stoneTypeNamePersian} • {product.product.widthValue}×{product.product.thicknessValue}cm
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500 dark:text-gray-400">تعداد:</label>
                          <FormattedNumberInput
                            value={product.quantity}
                            onChange={(value) => {
                              const newProducts = [...wizardData.products];
                              newProducts[index].quantity = value;
                              newProducts[index].totalPrice = newProducts[index].quantity * newProducts[index].unitPrice;
                              updateWizardData({ products: newProducts });
                            }}
                            className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            min={1}
                          />
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-teal-600 dark:text-teal-400">
                            {product.totalPrice.toLocaleString()} {product.currency}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const newProducts = wizardData.products.filter((_, i) => i !== index);
                            updateWizardData({ products: newProducts });
                          }}
                          className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <FaTrash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 5: Delivery Schedule */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <FaTruck className="text-teal-400" />
            برنامه تحویل
          </h2>
          <div className="space-y-4">
            <button
              onClick={() => {
                const newDelivery: DeliverySchedule = {
                  deliveryDate: new Date().toLocaleDateString('fa-IR'),
                  deliveryAddress: wizardData.project?.address || '',
                  products: [...wizardData.products],
                  driver: '',
                  vehicle: '',
                  notes: ''
                };
                updateWizardData({
                  deliveries: [...wizardData.deliveries, newDelivery]
                });
              }}
              className="w-full p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-teal-500 transition-colors"
            >
              <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                <FaPlus className="w-4 h-4" />
                افزودن برنامه تحویل جدید
              </div>
            </button>
            
            {wizardData.deliveries.map((delivery, index) => (
              <div key={index} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">تاریخ تحویل</label>
                    <input
                      type="text"
                      value={delivery.deliveryDate}
                      onChange={(e) => {
                        const newDeliveries = [...wizardData.deliveries];
                        newDeliveries[index].deliveryDate = e.target.value;
                        updateWizardData({ deliveries: newDeliveries });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">آدرس تحویل</label>
                    <input
                      type="text"
                      value={delivery.deliveryAddress}
                      onChange={(e) => {
                        const newDeliveries = [...wizardData.deliveries];
                        newDeliveries[index].deliveryAddress = e.target.value;
                        updateWizardData({ deliveries: newDeliveries });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">راننده</label>
                    <input
                      type="text"
                      value={delivery.driver}
                      onChange={(e) => {
                        const newDeliveries = [...wizardData.deliveries];
                        newDeliveries[index].driver = e.target.value;
                        updateWizardData({ deliveries: newDeliveries });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">وسیله نقلیه</label>
                    <input
                      type="text"
                      value={delivery.vehicle}
                      onChange={(e) => {
                        const newDeliveries = [...wizardData.deliveries];
                        newDeliveries[index].vehicle = e.target.value;
                        updateWizardData({ deliveries: newDeliveries });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-400 mb-2">توضیحات</label>
                    <textarea
                      value={delivery.notes}
                      onChange={(e) => {
                        const newDeliveries = [...wizardData.deliveries];
                        newDeliveries[index].notes = e.target.value;
                        updateWizardData({ deliveries: newDeliveries });
                      }}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    />
                  </div>
                </div>
                <button
                  onClick={() => {
                    const newDeliveries = wizardData.deliveries.filter((_, i) => i !== index);
                    updateWizardData({ deliveries: newDeliveries });
                  }}
                  className="mt-3 p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <FaTrash className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Step 6: Payment Method */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <FaCreditCard className="text-teal-400" />
            روش پرداخت
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">نحوه پرداخت</label>
              <select
                value={wizardData.payment.method}
                onChange={(e) => {
                  const method = e.target.value as 'CASH' | 'RECEIPT_BASE' | 'CHECK';
                  updateWizardData({
                    payment: {
                      ...wizardData.payment,
                      method,
                      totalAmount: wizardData.products.reduce((sum, p) => sum + p.totalPrice, 0)
                    }
                  });
                }}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              >
                <option value="CASH">نقدی کامل</option>
                <option value="RECEIPT_BASE">قسطی (بر اساس رسید)</option>
                <option value="CHECK">چکی (قسطی)</option>
              </select>
            </div>
            
            {wizardData.payment.method === 'CHECK' && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">کد ملی</label>
                <input
                  type="text"
                  value={wizardData.payment.nationalCode || ''}
                  onChange={(e) => {
                    updateWizardData({
                      payment: {
                        ...wizardData.payment,
                        nationalCode: e.target.value
                      }
                    });
                  }}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  placeholder="کد ملی مشتری"
                />
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">توضیحات پرداخت</label>
              <textarea
                value={wizardData.payment.notes || ''}
                onChange={(e) => {
                  updateWizardData({
                    payment: {
                      ...wizardData.payment,
                      notes: e.target.value
                    }
                  });
                }}
                rows={3}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 resize-none"
                placeholder="توضیحات اضافی در مورد پرداخت..."
              />
            </div>
          </div>
        </div>

        {/* Basic Information */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <FaFileContract className="text-teal-400" />
            اطلاعات پایه
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">عنوان (انگلیسی)</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  placeholder="Contract Title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">عنوان (فارسی)</label>
                <input
                  type="text"
                  name="titlePersian"
                  value={formData.titlePersian}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  placeholder="عنوان قرارداد"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">مبلغ کل</label>
                <FormattedNumberInput
                  value={parseFloat(formData.totalAmount) || 0}
                  onChange={(value) => setFormData(prev => ({ ...prev, totalAmount: value.toString() }))}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">واحد پول</label>
                <select
                  name="currency"
                  value={formData.currency}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ریال">ریال</option>
                  <option value="دلار">دلار</option>
                  <option value="یورو">یورو</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4">یادداشت‌ها</h2>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">یادداشت‌های اضافی</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              rows={4}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 resize-none"
              placeholder="یادداشت‌های اضافی..."
            />
          </div>
        </div>

        {/* Save Actions */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-400">
              مبلغ کل: {wizardData.products.reduce((sum, product) => sum + product.totalPrice, 0).toLocaleString('fa-IR')} ریال
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(`/dashboard/sales/contracts/${contract.id}`)}
                className="glass-liquid-btn py-3 px-6"
              >
                <div className="flex items-center justify-center gap-2">
                  <FaTimes />
                  انصراف
                </div>
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="glass-liquid-btn-primary py-3 px-6 disabled:opacity-50"
              >
                {saving ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    در حال ذخیره...
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <FaSave />
                    ذخیره تغییرات
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5000');
const API_BASE = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;
export const API_ORIGIN = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE;

export const resolveBackendAssetUrl = (url?: string | null) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  return url.startsWith('/') ? url : `/${url}`;
};

// Create axios instance
const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (identifier: string, password: string) =>
    api.post('/auth/login', { identifier, email: identifier, password }),
  
  register: (userData: {
    email: string;
    username: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => api.post('/auth/register', userData),
  
  getMe: () => api.get('/auth/me'),
};

// Users API
export const usersAPI = {
  getUsers: (page = 1, limit = 10) =>
    api.get(`/users?page=${page}&limit=${limit}`),
  
  getUser: (id: string) => api.get(`/users/${id}`),
  
  createUser: (userData: {
    email: string;
    username: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: string;
    departmentId?: string;
    isActive?: boolean;
    personnelMode?: 'auto' | 'existing';
    personnelId?: string;
    workspacePermissions?: Array<{
      workspace: string;
      permissionLevel: string;
      expiresAt?: string;
    }>;
    featurePermissions?: Array<{
      workspace: string;
      feature: string;
      permissionLevel: string;
      expiresAt?: string;
    }>;
  }) => api.post('/users', userData),
  
  updateUser: (id: string, userData: any) =>
    api.put(`/users/${id}`, userData),
  
  deleteUser: (id: string) => api.delete(`/users/${id}`),
};

export const personnelAPI = {
  getPersonnel: (params?: { includeInactive?: boolean; search?: string; departmentId?: string }) =>
    api.get('/personnel', { params }),
  getPerson: (id: string) => api.get(`/personnel/${id}`),
  createPerson: (data: any) => api.post('/personnel', data),
  updatePerson: (id: string, data: any) => api.put(`/personnel/${id}`, data),
  deletePerson: (id: string) => api.delete(`/personnel/${id}`),
};

// Posts API
export const postsAPI = {
  getPosts: (page = 1, limit = 10, published?: boolean) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (published !== undefined) {
      params.append('published', published.toString());
    }
    return api.get(`/posts?${params.toString()}`);
  },
  
  getPost: (id: string) => api.get(`/posts/${id}`),
  
  createPost: (postData: { title: string; content: string; published?: boolean }) =>
    api.post('/posts', postData),
  
  updatePost: (id: string, postData: any) =>
    api.put(`/posts/${id}`, postData),
  
  deletePost: (id: string) => api.delete(`/posts/${id}`),
};

// Orders API
export const ordersAPI = {
  getOrders: (page = 1, limit = 10, status?: string) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (status) {
      params.append('status', status);
    }
    return api.get(`/orders?${params.toString()}`);
  },
  
  getOrder: (id: string) => api.get(`/orders/${id}`),
  
  createOrder: (orderData: { total: number }) =>
    api.post('/orders', orderData),
  
  updateOrderStatus: (id: string, status: string) =>
    api.put(`/orders/${id}/status`, { status }),
  
  deleteOrder: (id: string) => api.delete(`/orders/${id}`),
};

// Dashboard API
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
  getProfile: () => api.get('/dashboard/profile'),
};

// Workspace Permissions API
export const workspacePermissionsAPI = {
  getUserWorkspaces: () => api.get('/workspace-permissions/user-workspaces'),
  getUserPermissions: (params?: { page?: number; limit?: number; userId?: string; workspace?: string }) =>
    api.get('/workspace-permissions', { params }),
  getRolePermissions: (params?: { role?: string; workspace?: string }) =>
    api.get('/workspace-permissions/role-permissions', { params }),
  createUserPermission: (data: any) => api.post('/workspace-permissions', data),
  updateUserPermission: (id: string, data: any) => api.put(`/workspace-permissions/${id}`, data),
  deleteUserPermission: (id: string) => api.delete(`/workspace-permissions/${id}`),
  createRolePermission: (data: any) => api.post('/workspace-permissions/role-permissions', data),
  updateRolePermission: (id: string, data: any) => api.put(`/workspace-permissions/role-permissions/${id}`, data),
  deleteRolePermission: (id: string) => api.delete(`/workspace-permissions/role-permissions/${id}`),
};

// Departments API
export const departmentsAPI = {
  getDepartments: () => api.get('/departments'),
  getDepartment: (id: string) => api.get(`/departments/${id}`),
  createDepartment: (data: any) => api.post('/departments', data),
  updateDepartment: (id: string, data: any) => api.put(`/departments/${id}`, data),
  deleteDepartment: (id: string) => api.delete(`/departments/${id}`),
};

// Sales Workspace API
export const salesAPI = {
  // Contracts
  getContracts: (params?: { page?: number; limit?: number; status?: string; departmentId?: string; search?: string }) =>
    api.get('/sales/contracts', { params }),
  
  getContract: (id: string) => api.get(`/sales/contracts/${id}`),
  
  createContract: (contractData: any) => api.post('/sales/contracts', contractData),
  
  updateContract: (id: string, contractData: any) => api.put(`/sales/contracts/${id}`, contractData),
  
  approveContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/approve`, { note }),
  
  rejectContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/reject`, { note }),
  
  signContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/sign`, { note }),
  
  printContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/print`, { note }),

  getContractPdf: (contractId: string, params?: { fresh?: boolean; variant?: 'original' | 'summary' }) =>
    api.get(`/sales/contracts/${contractId}/pdf`, { params }),

  downloadContractPdf: (contractId: string, params?: { fresh?: boolean; variant?: 'original' | 'summary' }) =>
    api.get(`/sales/contracts/${contractId}/pdf`, {
      params: { ...params, download: true },
      responseType: 'blob'
    }),
  
  deleteContract: (id: string) => api.delete(`/sales/contracts/${id}`),
  
  // Dashboard
  getSalesStats: () => api.get('/sales/dashboard/stats'),
  
  // Deliveries
  getDeliveries: (contractId: string) => api.get(`/sales/contracts/${contractId}/deliveries`),
  
  createDelivery: (contractId: string, deliveryData: any) => api.post(`/sales/contracts/${contractId}/deliveries`, deliveryData),
  
  // Payments
  getPayments: (contractId: string) => api.get(`/sales/contracts/${contractId}/payments`),
  
  createPayment: (contractId: string, paymentData: any) => api.post(`/sales/contracts/${contractId}/payments`, paymentData),
  
  // Digital confirmation
  sendForConfirmation: (contractId: string) =>
    api.post(`/sales/contracts/${contractId}/send-for-confirmation`),

  resendConfirmation: (contractId: string) =>
    api.post(`/sales/contracts/${contractId}/resend-confirmation`),

  getConfirmationStatus: (contractId: string) =>
    api.get(`/sales/contracts/${contractId}/confirmation-status`),

  cancelContract: (contractId: string) =>
    api.post(`/sales/contracts/${contractId}/cancel`),
  
  // Contract Items
  createContractItem: (contractId: string, itemData: any) => api.post(`/sales/contracts/${contractId}/items`, itemData),
  
  // Products
  getProducts: (params?: any) => api.get('/products', { params }),
  
  getProduct: (id: string) => api.get(`/products/${id}`),
  
  createProduct: (productData: any) => api.post('/products', productData),
  
  updateProduct: (id: string, productData: any) => api.put(`/products/${id}`, productData),
  
  deleteProduct: (id: string) => api.delete(`/products/${id}`),
  
  // Excel Import/Export
  downloadProductTemplate: () => api.get('/products/template', { responseType: 'blob' }),
  previewProductImport: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/products/import/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  applyProductImport: (importId: string) => api.post('/products/import/apply', { importId }),
  importProducts: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/products/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  exportProducts: (params?: any) => api.get('/products/export', { 
    params, 
    responseType: 'blob' 
  }),

  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post('/uploads/images', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  
  // Departments
  getDepartments: () => api.get('/departments'),
  
  // Contract Number Generation
  getNextContractNumber: () => api.get('/sales/contracts/next-number'),

  // Contract discount ranges
  getDiscountRanges: (params?: { activeOnly?: boolean }) => api.get('/sales/discount-ranges', { params }),
  createDiscountRange: (data: any) => api.post('/sales/discount-ranges', data),
  updateDiscountRange: (id: string, data: any) => api.put(`/sales/discount-ranges/${id}`, data),
  deleteDiscountRange: (id: string) => api.delete(`/sales/discount-ranges/${id}`),
};

// CRM Workspace API
export const crmAPI = {
  // Customers
  getCustomers: (params?: { page?: number; limit?: number; search?: string; status?: string; customerType?: string }) =>
    api.get('/crm/customers', { params }),

  getCustomerOwners: () => api.get('/crm/customer-owners'),
  getSellers: () => api.get('/crm/sellers'),
  
  getCustomer: (id: string) => api.get(`/crm/customers/${id}`),

  checkDuplicateCustomer: (payload: { nationalCode?: string | null; phoneNumbers?: Array<{ number?: string | null }> }) =>
    api.post('/crm/customers/duplicate-check', payload),
  
  createCustomer: (customerData: any) => api.post('/crm/customers', customerData),
  
  updateCustomer: (id: string, customerData: any) => api.put(`/crm/customers/${id}`, customerData),

  assignCustomerOwner: (id: string, ownerUserId: string | null) =>
    api.put(`/crm/customers/${id}/owner`, { ownerUserId }),
  
  deleteCustomer: (id: string) => api.delete(`/crm/customers/${id}`),
  
  // Project Addresses
  addProjectAddress: (customerId: string, addressData: any) => 
    api.post(`/crm/customers/${customerId}/project-addresses`, addressData),
  updateProjectAddress: (customerId: string, addressId: string, addressData: any) => 
    api.put(`/crm/customers/${customerId}/project-addresses/${addressId}`, addressData),
  deleteProjectAddress: (customerId: string, addressId: string) => 
    api.delete(`/crm/customers/${customerId}/project-addresses/${addressId}`),
  
  // Phone Numbers
  addPhoneNumber: (customerId: string, phoneData: any) => 
    api.post(`/crm/customers/${customerId}/phone-numbers`, phoneData),
  updatePhoneNumber: (customerId: string, phoneId: string, phoneData: any) => 
    api.put(`/crm/customers/${customerId}/phone-numbers/${phoneId}`, phoneData),
  deletePhoneNumber: (customerId: string, phoneId: string) => 
    api.delete(`/crm/customers/${customerId}/phone-numbers/${phoneId}`),
  
  // Blacklist/Lock Management
  toggleBlacklist: (id: string) => api.put(`/crm/customers/${id}/blacklist`),
  toggleLock: (id: string) => api.put(`/crm/customers/${id}/lock`),
  
  // Contacts
  getContacts: (params?: { page?: number; limit?: number; customerId?: string }) =>
    api.get('/crm/contacts', { params }),
  
  getContact: (id: string) => api.get(`/crm/contacts/${id}`),
  
  createContact: (customerIdOrData: string | any, contactData?: any) => {
    if (typeof customerIdOrData === 'string') {
      return api.post(`/crm/customers/${customerIdOrData}/contacts`, contactData);
    }
    return api.post(`/crm/customers/${customerIdOrData.customerId}/contacts`, customerIdOrData);
  },
  
  updateContact: (customerIdOrId: string, contactIdOrData: string | any, contactData?: any) => {
    if (typeof contactIdOrData === 'string') {
      return api.put(`/crm/customers/${customerIdOrId}/contacts/${contactIdOrData}`, contactData);
    }
    return api.put(`/crm/contacts/${customerIdOrId}`, contactIdOrData);
  },
  
  deleteContact: (customerIdOrId: string, contactId?: string) => {
    if (contactId) {
      return api.delete(`/crm/customers/${customerIdOrId}/contacts/${contactId}`);
    }
    return api.delete(`/crm/contacts/${customerIdOrId}`);
  },
  
  // Leads
  getLeads: (params?: { page?: number; limit?: number; status?: string; assignedTo?: string }) =>
    api.get('/crm/leads', { params }),
  
  getLead: (id: string) => api.get(`/crm/leads/${id}`),
  
  createLead: (leadData: any) => api.post('/crm/leads', leadData),
  
  updateLead: (id: string, leadData: any) => api.put(`/crm/leads/${id}`, leadData),
  
  deleteLead: (id: string) => api.delete(`/crm/leads/${id}`),
  
  // Communications
  getCommunications: (params?: { page?: number; limit?: number; customerId?: string; contactId?: string }) =>
    api.get('/crm/communications', { params }),
  
  getCommunication: (id: string) => api.get(`/crm/communications/${id}`),
  
  createCommunication: (communicationData: any) => api.post('/crm/communications', communicationData),
  
  updateCommunication: (id: string, communicationData: any) => api.put(`/crm/communications/${id}`, communicationData),
  
  deleteCommunication: (id: string) => api.delete(`/crm/communications/${id}`),
  
  // Dashboard
  getCrmStats: () => api.get('/crm/dashboard'),

  // Potential Projects
  getPotentialProjects: (params?: any) => api.get('/crm/potential-projects', { params }),
  getPotentialProject: (id: string) => api.get(`/crm/potential-projects/${id}`),
  createPotentialProject: (data: any) => api.post('/crm/potential-projects', data),
  updatePotentialProject: (id: string, data: any) => api.put(`/crm/potential-projects/${id}`, data),
  reassignPotentialProject: (id: string, data: { responsibleSellerId: string; reason: string }) =>
    api.put(`/crm/potential-projects/${id}/reassign`, data),

  // Follow-up reports and next actions
  getFollowUps: (params?: any) => api.get('/crm/follow-ups', { params }),
  createFollowUp: (data: any) => api.post('/crm/follow-ups', data),
  getNextActions: (params?: any) => api.get('/crm/next-actions', { params }),
  completeNextAction: (id: string) => api.put(`/crm/next-actions/${id}/complete`),
};

// Inventory Workspace API
export const inventoryAPI = {
  // Cut Types
  getCutTypes: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/cut-types', { params }),
  
  getCutType: (id: string) => api.get(`/inventory/cut-types/${id}`),
  
  createCutType: (cutTypeData: any) => api.post('/inventory/cut-types', cutTypeData),
  
  updateCutType: (id: string, cutTypeData: any) => api.put(`/inventory/cut-types/${id}`, cutTypeData),
  
  deleteCutType: (id: string) => api.delete(`/inventory/cut-types/${id}`),
  
  // Stone Materials
  getStoneMaterials: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/stone-materials', { params }),
  
  getStoneMaterial: (id: string) => api.get(`/inventory/stone-materials/${id}`),
  
  createStoneMaterial: (stoneMaterialData: any) => api.post('/inventory/stone-materials', stoneMaterialData),
  
  updateStoneMaterial: (id: string, stoneMaterialData: any) => api.put(`/inventory/stone-materials/${id}`, stoneMaterialData),
  
  deleteStoneMaterial: (id: string) => api.delete(`/inventory/stone-materials/${id}`),
  
  // Cut Widths
  getCutWidths: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/cut-widths', { params }),
  
  getCutWidth: (id: string) => api.get(`/inventory/cut-widths/${id}`),
  
  createCutWidth: (cutWidthData: any) => api.post('/inventory/cut-widths', cutWidthData),
  
  updateCutWidth: (id: string, cutWidthData: any) => api.put(`/inventory/cut-widths/${id}`, cutWidthData),
  
  deleteCutWidth: (id: string) => api.delete(`/inventory/cut-widths/${id}`),
  
  // Thicknesses
  getThicknesses: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/thicknesses', { params }),
  
  getThickness: (id: string) => api.get(`/inventory/thicknesses/${id}`),
  
  createThickness: (thicknessData: any) => api.post('/inventory/thicknesses', thicknessData),
  
  updateThickness: (id: string, thicknessData: any) => api.put(`/inventory/thicknesses/${id}`, thicknessData),
  
  deleteThickness: (id: string) => api.delete(`/inventory/thicknesses/${id}`),
  
  // Mines
  getMines: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/mines', { params }),
  
  getMine: (id: string) => api.get(`/inventory/mines/${id}`),
  
  createMine: (mineData: any) => api.post('/inventory/mines', mineData),
  
  updateMine: (id: string, mineData: any) => api.put(`/inventory/mines/${id}`, mineData),
  
  deleteMine: (id: string) => api.delete(`/inventory/mines/${id}`),
  
  // Finish Types
  getFinishTypes: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/finish-types', { params }),
  
  getFinishType: (id: string) => api.get(`/inventory/finish-types/${id}`),
  
  createFinishType: (finishTypeData: any) => api.post('/inventory/finish-types', finishTypeData),
  
  updateFinishType: (id: string, finishTypeData: any) => api.put(`/inventory/finish-types/${id}`, finishTypeData),
  
  deleteFinishType: (id: string) => api.delete(`/inventory/finish-types/${id}`),
  
  // Colors
  getColors: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/colors', { params }),
  
  getColor: (id: string) => api.get(`/inventory/colors/${id}`),
  
  createColor: (colorData: any) => api.post('/inventory/colors', colorData),
  
  updateColor: (id: string, colorData: any) => api.put(`/inventory/colors/${id}`, colorData),
  
  deleteColor: (id: string) => api.delete(`/inventory/colors/${id}`),
};

// Accounting Workspace API
export const accountingAPI = {
  getWorkspace: () => api.get('/accounting/workspace'),
  getContracts: (params?: any) => api.get('/accounting/contracts', { params }),
  getContract: (contractId: string) => api.get(`/accounting/contracts/${contractId}`),
  getContractPdf: (contractId: string) => api.get(`/accounting/contracts/${contractId}/pdf`),
  downloadContractPdf: (contractId: string) =>
    api.get(`/accounting/contracts/${contractId}/pdf`, {
      params: { download: true },
      responseType: 'blob'
    }),
  getSalesContractPdf: (contractId: string, params?: any) =>
    api.get(`/accounting/contracts/${contractId}/sales-pdf`, { params }),
  downloadSalesContractPdf: (contractId: string, params?: any) =>
    api.get(`/accounting/contracts/${contractId}/sales-pdf`, {
      params: { ...params, download: true },
      responseType: 'blob'
    }),
  getFinancialRecords: (params?: any) => api.get('/accounting/financial-records', { params }),
  getReceivables: (params?: any) => api.get('/accounting/receivables', { params }),
  getPayments: (params?: any) => api.get('/accounting/payments', { params }),
  getTaxRecords: (params?: any) => api.get('/accounting/tax', { params }),
  getCorrectionRequests: (params?: any) => api.get('/accounting/correction-requests', { params }),
  getAuditLogs: (params?: any) => api.get('/accounting/audit', { params }),
  getPerformanceReport: (params?: any) => api.get('/accounting/performance', { params }),
  getSettings: () => api.get('/accounting/settings'),
  updateSettings: (data: any) => api.put('/accounting/settings', data),
  executeAction: (data: any) => api.post('/accounting/actions', data),
};

export const biAPI = {
  getSalesOverview: (params?: any) => api.get('/bi/sales/overview', { params }),
  exportSalesTable: (table: string, params?: any) =>
    api.get(`/bi/sales/export/${table}`, { params, responseType: 'blob' }),
  downloadSalesSummaryPdf: (params?: any) =>
    api.get('/bi/sales/summary.pdf', { params, responseType: 'blob' }),
};

export const logisticsAPI = {
  getDashboard: () => api.get('/logistics/dashboard'),
  getLoadableCustomers: (params?: any) => api.get('/logistics/customers', { params }),
  getCustomerProjects: (customerId: string) => api.get(`/logistics/customers/${customerId}/projects`),
  getProjects: (params?: any) => api.get('/logistics/projects', { params }),
  getRemaining: (projectId: string) => api.get(`/logistics/projects/${projectId}/remaining`),
  createOrResumeDraft: (projectId: string, data?: any) => api.post(`/logistics/projects/${projectId}/draft`, data || {}),
  getLoadings: (params?: any) => api.get('/logistics/loadings', { params }),
  createLoading: (data: any) => api.post('/logistics/loadings', data),
  getLoading: (id: string) => api.get(`/logistics/loadings/${id}`),
  updateLoading: (id: string, data: any) => api.put(`/logistics/loadings/${id}`, data),
  deleteLoading: (id: string) => api.delete(`/logistics/loadings/${id}`),
  finalizeLoading: (id: string) => api.post(`/logistics/loadings/${id}/finalize`),
  cancelLoading: (id: string, reason: string) => api.post(`/logistics/loadings/${id}/cancel`, { reason }),
  createCorrection: (id: string, data: any) => api.post(`/logistics/loadings/${id}/corrections`, data),
  getDrivers: (params?: any) => api.get('/logistics/drivers', { params }),
};

// Contract Templates API
export const contractTemplatesAPI = {
  getAll: (params?: { page?: number; limit?: number; category?: string; isActive?: boolean }) =>
    api.get('/contract-templates', { params }),
  
  getById: (id: string) => api.get(`/contract-templates/${id}`),
  
  create: (templateData: {
    name: string;
    namePersian: string;
    description?: string;
    content: string;
    variables?: any;
    structure?: any;
    calculations?: any;
    category?: string;
  }) => api.post('/contract-templates', templateData),
  
  update: (id: string, templateData: {
    name: string;
    namePersian: string;
    description?: string;
    content: string;
    variables?: any;
    structure?: any;
    calculations?: any;
    category?: string;
    isActive?: boolean;
  }) => api.put(`/contract-templates/${id}`, templateData),
  
  delete: (id: string) => api.delete(`/contract-templates/${id}`),
  
  generateContract: (id: string, contractData: {
    customerId: string;
    departmentId: string;
    contractData: any;
    title?: string;
    titlePersian?: string;
  }) => api.post(`/contract-templates/${id}/generate`, contractData),
};

// Customers API
const warnLegacyCustomersApiUsage = (action: string) => {
  if (typeof window === 'undefined') return;
  console.warn('[legacy-customers-api-usage]', {
    action,
    path: window.location.pathname,
    source: 'frontend/src/lib/api.ts',
    message: 'Use crmAPI for new sales contract flow.'
  });
};

const publicApi = axios.create({
  baseURL: `${API_BASE}/public`,
  headers: {
    'Content-Type': 'application/json'
  }
});

export const publicContractsAPI = {
  lookupConfirmationContract: (contractNumber: string, phoneNumber: string) =>
    publicApi.post('/contracts/confirm/lookup', { contractNumber, phoneNumber }),

  verifyManualConfirmationCode: (contractNumber: string, phoneNumber: string, code: string) =>
    publicApi.post('/contracts/confirm/verify', { contractNumber, phoneNumber, code }),

  resendManualConfirmationCode: (contractNumber: string, phoneNumber: string) =>
    publicApi.post('/contracts/confirm/resend', { contractNumber, phoneNumber }),

  getConfirmationContract: (token: string) =>
    publicApi.get(`/contracts/confirm/${token}`),

  verifyConfirmationCode: (token: string, code: string) =>
    publicApi.post(`/contracts/confirm/${token}/verify`, { code }),

  resendConfirmationCode: (token: string) =>
    publicApi.post(`/contracts/confirm/${token}/resend`)
};

export const customersAPI = {
  getAll: (params?: { page?: number; limit?: number; search?: string }) =>
    (warnLegacyCustomersApiUsage('getAll'), api.get('/customers', { params })),
  
  getById: (id: string) => (warnLegacyCustomersApiUsage('getById'), api.get(`/customers/${id}`)),
  
  create: (customerData: {
    firstName: string;
    lastName: string;
    companyName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
  }) => (warnLegacyCustomersApiUsage('create'), api.post('/customers', customerData)),
  
  update: (id: string, customerData: {
    firstName: string;
    lastName: string;
    companyName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
  }) => (warnLegacyCustomersApiUsage('update'), api.put(`/customers/${id}`, customerData)),
  
  delete: (id: string) => (warnLegacyCustomersApiUsage('delete'), api.delete(`/customers/${id}`)),
};


// Contracts API
export const contractsAPI = {
  getAll: (params?: { page?: number; limit?: number; status?: string; departmentId?: string }) =>
    api.get('/contracts', { params }),
  
  getById: (id: string) => api.get(`/contracts/${id}`),
  
  create: (contractData: {
    title: string;
    titlePersian: string;
    customerId: string;
    departmentId: string;
    templateId?: string;
    totalAmount?: number;
    currency?: string;
    notes?: string;
  }) => api.post('/contracts', contractData),
  
  update: (id: string, contractData: {
    title?: string;
    titlePersian?: string;
    status?: string;
    totalAmount?: number;
    currency?: string;
    notes?: string;
  }) => api.put(`/contracts/${id}`, contractData),
  
  approve: (id: string, note?: string) =>
    api.put(`/contracts/${id}/approve`, { note }),

  reject: (id: string, note?: string) =>
    api.put(`/contracts/${id}/reject`, { note }),

  sign: (id: string, note?: string) =>
    api.put(`/contracts/${id}/sign`, { note }),

  print: (id: string, note?: string) =>
    api.put(`/contracts/${id}/print`, { note }),
  
  delete: (id: string) => api.delete(`/contracts/${id}`),
};

export const securityAPI = {
  // Shift management
  getShifts: () => api.get('/security/shifts'),
  createShift: (data: any) => api.post('/security/shifts', data),
  startShift: (shiftId: string) => api.post('/security/shifts/start', { shiftId }),
  endShift: () => api.post('/security/shifts/end'),
  getShiftPlans: (includeDrafts = false) => api.get('/security/shift-plans', { params: { includeDrafts } }),
  getShiftPlanDefaults: () => api.get('/security/shift-plans/defaults'),
  createShiftPlan: (data: any) => api.post('/security/shift-plans', data),
  publishShiftPlan: (id: string) => api.post(`/security/shift-plans/${id}/publish`),
  deleteShiftPlan: (id: string) => api.delete(`/security/shift-plans/${id}`),
  getShiftPlanSlots: (params?: any) => api.get('/security/shift-plan-slots', { params }),
  setShiftReplacement: (id: string, personnelId: string, overrideReason?: string) => api.put(`/security/shift-plan-slots/${id}/replacement`, { personnelId, overrideReason }),
  markShiftEmergencyUncovered: (id: string, reason: string) => api.put(`/security/shift-plan-slots/${id}/emergency-uncovered`, { reason }),
  addTemporaryShiftCoverage: (id: string, data: any) => api.post(`/security/shift-plan-slots/${id}/temporary-coverage`, data),
  getCurrentShiftWorkflow: () => api.get('/security/shift-workflow/current'),
  getMyShiftWorkflow: (params?: { from?: string; to?: string }) => api.get('/security/shift-workflow/me', { params }),
  registerShiftAttendance: (slotId: string) => api.post(`/security/shift-plan-slots/${slotId}/attendance`),
  startPlannedShift: (slotId: string) => api.post(`/security/shift-plan-slots/${slotId}/start`),
  endPlannedShift: (slotId: string, closureSummary?: string) => api.post(`/security/shift-plan-slots/${slotId}/end`, { closureSummary }),
  forceCloseShift: (sessionId: string, reason: string, summary: string) => api.post(`/security/shift-sessions/${sessionId}/force-close`, { reason, summary }),
  correctShiftAttendance: (attendanceId: string, arrivedAt: string, reason: string) => api.put(`/security/shift-attendance/${attendanceId}/correct`, { arrivedAt, reason }),
  
  // Attendance management
  checkIn: (employeeId: string, entryTime?: string) => 
    api.post('/security/attendance/checkin', { employeeId, entryTime }),
  checkOut: (employeeId: string, exitTime?: string) => 
    api.post('/security/attendance/checkout', { employeeId, exitTime }),
  recordException: (data: any) => api.post('/security/attendance/exception', data),
  
  // Reports and dashboard
  getDailyAttendance: (dateOrParams?: string | Record<string, any>) => {
    const params = typeof dateOrParams === 'string' ? { date: dateOrParams } : dateOrParams;
    return api.get('/security/attendance/daily', { params });
  },
  getDashboardStats: (params?: any) => api.get('/security/dashboard/stats', { params }),
  getSecurityReportSummary: (params?: any) => api.get('/security/reports/summary', { params }),
  getSecurityPersonnelPerformance: (params?: any) => api.get('/security/reports/security-personnel-performance', { params }),
  getSecurityPersonnelShiftHistory: (id: string, params?: any) => api.get(`/security/reports/security-personnel/${id}/shift-history`, { params }),
  exportSecurityReport: (format: 'pdf' | 'excel', params?: any) => api.get('/security/reports/export', { params: { ...params, format }, responseType: 'blob' }),
  
  // Personnel management
  getPersonnel: () => api.get('/security/personnel'),
  getEligiblePersonnelUsers: () => api.get('/security/personnel/eligible-users'),
  assignPersonnel: (data: any) => api.post('/security/personnel', data),
  updatePersonnelStatus: (id: string, isActive: boolean) => api.put(`/security/personnel/${id}/status`, { isActive }),

  // Vehicle gate operations
  getVehiclePairs: (params?: any) => api.get('/security/vehicle-pairs', { params }),
  createVehiclePair: (data: FormData) => api.post('/security/vehicle-pairs', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateVehiclePair: (id: string, data: any) => api.put(`/security/vehicle-pairs/${id}`, data),
  deleteVehiclePair: (id: string) => api.delete(`/security/vehicle-pairs/${id}`),
  addVehiclePairPhotos: (id: string, data: FormData) => api.post(`/security/vehicle-pairs/${id}/photos`, data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteVehiclePairPhoto: (id: string, photoId: string) => api.delete(`/security/vehicle-pairs/${id}/photos/${photoId}`),
  getVehiclePairPhoto: (photoId: string) => api.get(`/security/vehicle-pairs/photos/${photoId}`, { responseType: 'blob' }),
  getDriverQueue: (history = false) => api.get('/security/driver-queue', { params: { history } }),
  enqueueDriver: (vehiclePairId: string) => api.post('/security/driver-queue', { vehiclePairId }),
  removeDriverFromQueue: (id: string, reason: string) => api.post(`/security/driver-queue/${id}/remove`, { reason }),
  enterDriverLoadingArea: (id: string) => api.post(`/security/driver-queue/${id}/enter-loading-area`),
  returnDriverToWaiting: (id: string, reason: string) => api.post(`/security/driver-queue/${id}/return-to-waiting`, { reason }),
  getVehicleMovements: (params?: any) => api.get('/security/vehicle-movements', { params }),
  getReadyExitLoadings: () => api.get('/security/vehicle-movements/ready-exit'),
  createInboundVehicleMovement: (data: any) => api.post('/security/vehicle-movements/inbound', data),
  completeVehicleMovement: (id: string, data: any) => api.put(`/security/vehicle-movements/${id}/complete`, data),
  recordVehicleExit: (data: any) => api.post('/security/vehicle-movements/exit', data),
  voidVehicleMovement: (id: string, reason: string) => api.put(`/security/vehicle-movements/${id}/void`, { reason }),
  addVehicleMovementAttachment: (id: string, data: any) => api.post(`/security/vehicle-movements/${id}/attachments`, data),
  getSupervisorReports: (params?: any) => api.get('/security/supervisor-reports', { params }),
  createSupervisorReport: (data: any) => api.post('/security/supervisor-reports', data),
  getInstantReportTypes: (includeInactive = false) => api.get('/security/instant-report-types', { params: { includeInactive } }),
  createInstantReportType: (data: any) => api.post('/security/instant-report-types', data),
  updateInstantReportType: (id: string, data: any) => api.put(`/security/instant-report-types/${id}`, data),
  getActiveShiftLog: () => api.get('/security/shift-log/active'),
  createShiftLogEntry: (data: FormData) => api.post('/security/shift-log/entries', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getShiftLogParticipants: () => api.get('/security/shift-log/participants'),
  voidShiftLogEntry: (id: string, reason: string) => api.put(`/security/shift-log/entries/${id}/void`, { reason }),
  startPatrol: () => api.post('/security/shift-log/patrols/start'),
  finishPatrol: (id: string, description: string) => api.put(`/security/shift-log/patrols/${id}/finish`, { description }),

  // Exception handling system
  createExceptionRequest: (data: any) => api.post('/security/exceptions/request', data),
  getExceptionRequests: (params?: any) => api.get('/security/exceptions/requests', { params }),
  approveExceptionRequest: (id: string, notes?: string) => 
    api.put(`/security/exceptions/${id}/approve`, { notes }),
  rejectExceptionRequest: (id: string, rejectionReason: string) => 
    api.put(`/security/exceptions/${id}/reject`, { rejectionReason }),

  // Mission management
  createMissionAssignment: (data: any) => api.post('/security/missions/assign', data),
  getMissionAssignments: (params?: any) => api.get('/security/missions', { params }),
  approveMissionAssignment: (id: string) => api.put(`/security/missions/${id}/approve`),

  // Digital signature management
  saveAttendanceSignature: (id: string, signatureData: string, signatureType?: string) => 
    api.put(`/security/attendance/${id}/signature`, { signatureData, signatureType }),
  getAttendanceSignature: (id: string) => api.get(`/security/attendance/${id}/signature`),
  validateSignature: (signatureData: string, employeeId: string) => 
    api.post('/security/signature/validate', { signatureData, employeeId }),
};

export const sabalanCalendarAPI = {
  getEntries: (params?: any) => api.get('/sabalan-calendar', { params }),
  createEntry: (data: any) => api.post('/sabalan-calendar', data),
  updateEntry: (id: string, data: any) => api.put(`/sabalan-calendar/${id}`, data),
};

// Permissions API
export const permissionsAPI = {
  // Feature permissions
  getFeaturePermissions: (params?: any) => api.get('/permissions/features', { params }),
  getFeatureDefinitions: () => api.get('/permissions/features/definitions'),
  createFeaturePermission: (data: any) => api.post('/permissions/features', data),
  bulkUpsertFeaturePermissions: (data: any) => api.post('/permissions/features/bulk', data),
  updateFeaturePermission: (id: string, data: any) => api.put(`/permissions/features/${id}`, data),
  deleteFeaturePermission: (id: string) => api.delete(`/permissions/features/${id}`),
  getUserFeaturePermissions: (userId: string) => api.get(`/permissions/features/user/${userId}`),
  
  // Role feature permissions
  getRoleFeaturePermissions: (params?: any) => api.get('/permissions/role-features', { params }),
  createRoleFeaturePermission: (data: any) => api.post('/permissions/role-features', data),
  updateRoleFeaturePermission: (id: string, data: any) => api.put(`/permissions/role-features/${id}`, data),
  deleteRoleFeaturePermission: (id: string) => api.delete(`/permissions/role-features/${id}`),
  
  // User features summary
  getUserFeaturesSummary: (userId: string) => api.get(`/permissions/user/${userId}/features`),
};

// Services API
export const servicesAPI = {
  // Services
  getServices: (params?: any) => api.get('/services', { params }),
  getService: (id: string) => api.get(`/services/${id}`),
  createService: (data: any) => api.post('/services', data),
  updateService: (id: string, data: any) => api.put(`/services/${id}`, data),
  deleteService: (id: string) => api.delete(`/services/${id}`),
  toggleServiceStatus: (id: string) => api.patch(`/services/${id}/toggle`),
  
  // Cutting Types
  getCuttingTypes: (params?: any) => api.get('/cutting-types', { params }),
  getCuttingType: (id: string) => api.get(`/cutting-types/${id}`),
  createCuttingType: (data: any) => api.post('/cutting-types', data),
  updateCuttingType: (id: string, data: any) => api.put(`/cutting-types/${id}`, data),
  deleteCuttingType: (id: string) => api.delete(`/cutting-types/${id}`),
  toggleCuttingTypeStatus: (id: string) => api.patch(`/cutting-types/${id}/toggle`),
  
  // Contract tools. Backed by the legacy sub-services API for compatibility.
  getSubServices: (params?: any) => api.get('/sub-services', { params }),
  getSubService: (id: string) => api.get(`/sub-services/${id}`),
  createSubService: (data: any) => api.post('/sub-services', data),
  updateSubService: (id: string, data: any) => api.put(`/sub-services/${id}`, data),
  deleteSubService: (id: string) => api.delete(`/sub-services/${id}`),
  toggleSubServiceStatus: (id: string) => api.patch(`/sub-services/${id}/toggle`),
  getTools: (params?: any) => api.get('/sub-services', { params }),
  getTool: (id: string) => api.get(`/sub-services/${id}`),
  createTool: (data: any) => api.post('/sub-services', data),
  updateTool: (id: string, data: any) => api.put(`/sub-services/${id}`, data),
  deleteTool: (id: string) => api.delete(`/sub-services/${id}`),
  toggleToolStatus: (id: string) => api.patch(`/sub-services/${id}/toggle`),

  // Stair standard lengths
  getStairStandardLengths: (params?: any) => api.get('/stair-standard-lengths', { params }),
  getStairStandardLength: (id: string) => api.get(`/stair-standard-lengths/${id}`),
  createStairStandardLength: (data: any) => api.post('/stair-standard-lengths', data),
  updateStairStandardLength: (id: string, data: any) => api.put(`/stair-standard-lengths/${id}`, data),
  deleteStairStandardLength: (id: string) => api.delete(`/stair-standard-lengths/${id}`),
  toggleStairStandardLengthStatus: (id: string) => api.patch(`/stair-standard-lengths/${id}/toggle`),

  // Layer types
  getLayerTypes: (params?: any) => api.get('/layer-types', { params }),
  getLayerType: (id: string) => api.get(`/layer-types/${id}`),
  createLayerType: (data: any) => api.post('/layer-types', data),
  updateLayerType: (id: string, data: any) => api.put(`/layer-types/${id}`, data),
  deleteLayerType: (id: string) => api.delete(`/layer-types/${id}`),
  toggleLayerTypeStatus: (id: string) => api.patch(`/layer-types/${id}/toggle`),

  // Stone finishing services
  getStoneFinishings: (params?: any) => api.get('/stone-finishings', { params }),
  getStoneFinishing: (id: string) => api.get(`/stone-finishings/${id}`),
  createStoneFinishing: (data: any) => api.post('/stone-finishings', data),
  updateStoneFinishing: (id: string, data: any) => api.put(`/stone-finishings/${id}`, data),
  deleteStoneFinishing: (id: string) => api.delete(`/stone-finishings/${id}`),
  toggleStoneFinishingStatus: (id: string) => api.patch(`/stone-finishings/${id}/toggle`),

  downloadCatalogTemplate: (catalog: string) => api.get(`/catalog-excel/${catalog}/template`, { responseType: 'blob' }),
  exportCatalog: (catalog: string) => api.get(`/catalog-excel/${catalog}/export`, { responseType: 'blob' }),
  previewCatalogImport: (catalog: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/catalog-excel/${catalog}/import/preview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  applyCatalogImport: (catalog: string, importId: string) => api.post(`/catalog-excel/${catalog}/import/apply`, { importId })
};

export default api;

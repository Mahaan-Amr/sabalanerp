# Sales Workspace - Updated Implementation Plan

## 🎯 Business Model Clarification

### Customer Type
- **Building Builders/Contractors**: Customers who buy natural stones for their construction projects
- **Project Concept**: Each building/construction project is a separate "project" for the customer
- **Multiple Projects**: Customers can have multiple active construction projects simultaneously
- **Project Manager**: Refers to the customer's project manager (not our internal staff)

### Product Management
- **No Stock Levels**: Manager manually updates product availability
- **Pricing Flexibility**: Sellers can adjust prices within certain formulas
- **Excel Catalog**: Complete product catalog in `kala-kod.xls` file

## 📋 Updated Requirements

### A. CRM Customer Management

#### Enhanced Customer Model
```typescript
interface CrmCustomer {
  id: string;
  firstName: string;
  lastName: string;
  projectAddresses: ProjectAddress[];
  phoneNumbers: PhoneNumber[];
  nationalCode?: string; // 10 digits, optional
  homeAddress?: string;
  homeNumber?: string;
  workAddress?: string;
  workNumber?: string;
  projectManagerName?: string; // Customer's project manager
  projectManagerNumber?: string; // Customer's project manager phone
  brandName?: string;
  brandNameDescription?: string;
  isBlacklisted: boolean; // Manager/Admin only can change
  isLocked: boolean; // Manager/Admin only can change
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectAddress {
  id: string;
  address: string;
  city: string;
  postalCode?: string;
  isActive: boolean;
  projectName?: string; // Building/construction project name
  projectType?: string; // Type of construction project
}

interface PhoneNumber {
  id: string;
  number: string;
  type: 'mobile' | 'home' | 'work' | 'other';
  isPrimary: boolean;
  isActive: boolean;
}
```

#### Customer Management Features
- **Multiple Active Projects**: Customers can have multiple construction projects
- **Project Information**: Track building/construction project details
- **Blacklist/Lock Management**: Only Manager/Admin roles can change status
- **Project Manager Tracking**: Customer's project manager information

### B. Product Catalog System

#### Product Model (Based on Excel Analysis Needed)
```typescript
interface Product {
  id: string;
  code: string; // From Excel
  name: string;
  namePersian: string;
  category: string;
  subcategory?: string;
  specifications: ProductSpecification[];
  basePrice: number;
  currency: string;
  isAvailable: boolean; // Manager manually updates
  leadTime?: number; // days
  description?: string;
  isActive: boolean;
}

interface ProductSpecification {
  name: string;
  value: string;
  unit?: string;
}
```

#### Product Management Features
- **Excel Import**: Import from `kala-kod.xls` file
- **Manual Availability**: Manager updates availability status
- **Flexible Pricing**: Sellers can adjust prices within formulas
- **No Stock Tracking**: Focus on availability, not quantities

### C. Contract Creation Flow (7-Step Wizard)

#### Step 1: Contract Date Selection
- Persian calendar with current date default
- Auto-generate contract number

#### Step 2: Customer Search & Selection
- Search existing customers from CRM
- Quick customer creation modal
- Display customer information and projects

#### Step 3: Project Management
- Display existing projects for selected customer
- Create new project modal
- Project information (building/construction details)

#### Step 4: Product Selection
- Product catalog search and filtering
- Product selection with quantity
- Price calculation with seller adjustments

#### Step 5: Delivery Scheduling
- Multiple delivery dates for large projects
- Persian calendar for delivery dates
- Delivery address selection

#### Step 6: Payment Method Selection
- **Cash Payment**: Immediate full payment
- **Receipt-based Payment**: Installment payments
- **Check-based Payment**: Check payments with national code requirement
- Payment tracking for accounting

#### Step 7: Digital Signature (Future)
- SMS integration with Kavenegar
- 1-hour verification code validity
- Contract completion

### D. Delivery Management System

#### Delivery Model
```typescript
interface Delivery {
  id: string;
  contractId: string;
  deliveryDate: Date;
  deliveryAddress: string;
  status: 'scheduled' | 'in-transit' | 'delivered' | 'cancelled';
  products: DeliveryProduct[];
  driver?: string;
  vehicle?: string;
  notes?: string;
  customerConfirmation?: boolean;
  confirmationCode?: string; // SMS code for confirmation
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface DeliveryProduct {
  productId: string;
  quantity: number;
  deliveredQuantity?: number;
  notes?: string;
}
```

#### Delivery Features
- **Status Tracking**: scheduled, in-transit, delivered, cancelled
- **Customer Confirmation**: SMS code verification
- **Multiple Deliveries**: Handle large projects with multiple delivery dates

### E. Payment System

#### Payment Model
```typescript
interface Payment {
  id: string;
  contractId: string;
  paymentMethod: 'cash' | 'receipt' | 'check';
  totalAmount: number;
  currency: string;
  paymentSchedule: PaymentSchedule[];
  status: 'pending' | 'partial' | 'completed' | 'overdue';
  nationalCode?: string; // Required for check payments
  createdAt: Date;
  updatedAt: Date;
}

interface PaymentSchedule {
  id: string;
  amount: number;
  dueDate: Date;
  status: 'pending' | 'paid' | 'overdue';
  paidAt?: Date;
  paidAmount?: number;
  notes?: string;
  receiptNumber?: string;
  checkNumber?: string;
}
```

#### Payment Features
- **Manual Tracking**: Accountants track payments manually
- **Payment Notifications**: Sales roles get notified of late/missed payments
- **Payment Reminders**: In-program reminders for accountants

### F. SMS Integration (Future)

#### SMS Features
- **Platform**: Kavenegar integration
- **Code Validity**: 1 hour
- **Use Cases**: Contract signing, delivery confirmation
- **Information**: Depends on use case (to be discussed later)

## 🚀 Implementation Phases

### Phase 1: CRM Customer Enhancement (Week 1)
- [ ] Update CrmCustomer model with all 15 fields
- [ ] Create ProjectAddress and PhoneNumber models
- [ ] Add blacklist/lock management (Manager/Admin only)
- [ ] Update customer creation and management forms
- [ ] Implement customer search and filtering

### Phase 2: Product Catalog System (Week 2)
- [ ] Analyze `kala-kod.xls` Excel file structure
- [ ] Create Product model and import system
- [ ] Implement product search and filtering
- [ ] Add manual availability management
- [ ] Create product selection interface

### Phase 3: Contract Wizard Redesign (Week 3-4)
- [ ] Create 7-step contract wizard
- [ ] Implement customer search and selection
- [ ] Add project management interface
- [ ] Create product selection with pricing
- [ ] Implement delivery scheduling
- [ ] Add payment method selection

### Phase 4: Delivery & Payment Management (Week 5)
- [ ] Implement delivery tracking system
- [ ] Add customer confirmation via SMS
- [ ] Create payment tracking interface
- [ ] Add payment notifications for sales roles
- [ ] Implement payment reminders for accountants

### Phase 5: SMS Integration (Future)
- [ ] Integrate Kavenegar SMS API
- [ ] Implement contract signing flow
- [ ] Add delivery confirmation system
- [ ] Create SMS code verification

## 🔧 Technical Implementation

### Database Schema Updates
```sql
-- Enhanced CRM Customer
ALTER TABLE CrmCustomer ADD COLUMN projectManagerName VARCHAR(255);
ALTER TABLE CrmCustomer ADD COLUMN projectManagerNumber VARCHAR(20);
ALTER TABLE CrmCustomer ADD COLUMN brandName VARCHAR(255);
ALTER TABLE CrmCustomer ADD COLUMN brandNameDescription TEXT;
ALTER TABLE CrmCustomer ADD COLUMN isBlacklisted BOOLEAN DEFAULT FALSE;
ALTER TABLE CrmCustomer ADD COLUMN isLocked BOOLEAN DEFAULT FALSE;

-- Project Addresses
CREATE TABLE ProjectAddress (
  id UUID PRIMARY KEY,
  customerId UUID REFERENCES CrmCustomer(id),
  address TEXT NOT NULL,
  city VARCHAR(100),
  postalCode VARCHAR(20),
  projectName VARCHAR(255),
  projectType VARCHAR(100),
  isActive BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Phone Numbers
CREATE TABLE PhoneNumber (
  id UUID PRIMARY KEY,
  customerId UUID REFERENCES CrmCustomer(id),
  number VARCHAR(20) NOT NULL,
  type VARCHAR(20) NOT NULL,
  isPrimary BOOLEAN DEFAULT FALSE,
  isActive BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Products (from Excel import)
CREATE TABLE Product (
  id UUID PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  namePersian VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  subcategory VARCHAR(100),
  basePrice DECIMAL(15,2),
  currency VARCHAR(10) DEFAULT 'RIAL',
  isAvailable BOOLEAN DEFAULT TRUE,
  leadTime INTEGER,
  description TEXT,
  isActive BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Delivery Management
CREATE TABLE Delivery (
  id UUID PRIMARY KEY,
  contractId UUID REFERENCES SalesContract(id),
  deliveryDate DATE NOT NULL,
  deliveryAddress TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled',
  driver VARCHAR(255),
  vehicle VARCHAR(255),
  notes TEXT,
  customerConfirmation BOOLEAN DEFAULT FALSE,
  confirmationCode VARCHAR(10),
  deliveredAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
```

### API Endpoints
- `POST /api/crm/customers` - Create customer with all fields
- `GET /api/crm/customers/search` - Search customers with filters
- `PUT /api/crm/customers/:id/blacklist` - Toggle blacklist (Manager/Admin only)
- `PUT /api/crm/customers/:id/lock` - Toggle lock (Manager/Admin only)
- `GET /api/sales/products` - Get product catalog
- `POST /api/sales/products/import` - Import from Excel
- `PUT /api/sales/products/:id/availability` - Update availability (Manager only)
- `POST /api/sales/contracts` - Create contract with 7-step wizard
- `GET /api/sales/deliveries` - Get delivery tracking
- `POST /api/sales/deliveries/:id/confirm` - Confirm delivery with SMS code

## 📊 Success Metrics

### Business Metrics
- Contract creation time: < 10 minutes
- Customer satisfaction: > 95%
- Payment collection rate: > 90%
- Delivery on-time rate: > 95%

### Technical Metrics
- Page load time: < 2 seconds
- API response time: < 200ms
- System uptime: > 99.9%
- Data accuracy: > 99%

---

**Last Updated**: September 21, 2025  
**Next Review**: September 28, 2025  
**Owner**: Sales Development Team

# Sablan ERP - Technical Specifications

## 🏗️ System Architecture

### Workspace Architecture ✅ COMPLETED
- **Workspace System**: Complete modular workspace architecture with role-based access control
- **Workspace Switcher**: 3 variants (dropdown, grid, sidebar) with permission-based access
- **Collapsible Navigation**: Workspace-specific navigation with collapsible sidebar
- **Workspace Context**: State management for workspace switching and permissions
- **API Architecture**: Workspace-specific endpoints (/api/sales/, /api/crm/, /api/security/)
- **Cross-workspace Integration**: Real-time data sharing and notification system

### Contract Template System ✅ COMPLETED
- **Enhanced Database Schema**: ContractTemplate and Contract models with structure, calculations, and contractData fields
- **Template Management API**: Complete CRUD operations for template management with variable substitution
- **Soblan Stone Template**: Complete sales contract template matching actual form structure
- **Variable System**: Dynamic variable configuration with types, validation, and auto-generation
- **Calculation Engine**: Formula-based calculations for area, price, and total amounts
- **Template Editor**: Comprehensive interface for template creation, editing, and management
- **Persian Integration**: RTL layout, Persian typography, and Persian number conversion

### Sales Workspace ✅ COMPLETED
- **7-Step Contract Creation Wizard**: Complete step-by-step contract creation with Persian calendar integration
- **Product Catalog System**: Excel import (386 products), management interface, filtering/search, grid/table views
- **Contract-CRM Integration**: Complete integration between contracts, customers, and products with "View Contract" functionality
- **Delivery & Payment Management**: Multi-date delivery scheduling and payment method selection
- **PDF Generation**: Pixel-perfect RTL PDF with optimized layout and proper formatting
- **Auto-incrementing Numbers**: Contract numbers starting from 1000 with sequential increment
- **Contract Management**: Complete contract view, edit, and status management system
- **API Integration**: Complete workspace-specific API endpoints with authentication and authorization

### CRM Workspace ✅ COMPLETED
- **Enhanced Customer Management**: CrmCustomer model with 15 comprehensive fields
- **Project Address Management**: Multiple project addresses per customer with relationships and full CRUD operations
- **Phone Number Management**: Multiple phone numbers with primary designation
- **Customer Creation Wizard**: 7-step wizard with validation and Persian interface
- **Advanced Search & Filtering**: Search by name, national code, project manager, brand name
- **Blacklist/Lock Management**: Manager/Admin only functionality for customer management
- **Customer Detail Pages**: Complete tabbed interface with full CRUD operations for projects and contacts
- **Contract Integration**: "View Contract" functionality linking to sales contracts
- **Enhanced UI Components**: Advanced dropdown components with search functionality
- **API Integration**: Complete workspace-specific API endpoints with authentication

### Security Management System ✅ **100% COMPLETED**
- **Digital Attendance System**: Check-in/check-out functionality with Persian calendar integration
- **Exception Handling**: Mission assignments, leave requests, approval workflow
- **Digital Signatures**: Electronic signature capture for attendance verification
- **Mobile Optimization**: Mobile-friendly interface with PWA support
- **Shift Management**: Day/Night shift system with automatic assignment
- **Security Personnel Management**: Role assignment and permissions
- **Workspace Integration**: 100% complete - fully integrated with workspace architecture

### Admin User Management System ✅ **100% COMPLETED**
- **User Management**: Complete user creation, editing, and deletion with role assignment
- **Workspace Permissions**: Granular workspace access control with view/edit/admin levels
- **Feature Permissions**: Feature-level granular permissions for cross-workspace access
- **Role-Based Access Control**: ADMIN, USER, MODERATOR roles with proper validation
- **Permission Audit Trail**: Complete tracking of permission changes and grants
- **Bulk Permission Management**: Manage multiple permissions simultaneously
- **User-Centric Interface**: Search users and manage their permissions efficiently

### Persian Calendar Integration ✅ **COMPLETED**
- **Persian Calendar Utility**: Comprehensive `PersianCalendar` class with full Jalali calendar support
- **Interactive Calendar Component**: Reusable `PersianCalendarComponent` with Persian month/day names
- **System-wide Integration**: All date displays updated to use Persian calendar formatting
- **Date Conversion**: Gregorian ↔ Persian (Jalali) conversion using `moment-jalaali` library
- **Persian Formatting**: Persian month names (فروردین، اردیبهشت، ...) and day names (یکشنبه، دوشنبه، ...)
- **Backend Compatibility**: Security API updated to handle Persian date conversions and filtering
- **TypeScript Support**: Full type safety with `@types/moment-jalaali` integration
- **RTL Layout**: Proper right-to-left layout for Persian calendar interface
- **Performance**: Optimized date operations and efficient calendar rendering

### Exception Handling System ✅ **COMPLETED**
- **Exception Request Management**: Comprehensive leave request system with approval workflow
- **Mission Assignment System**: Complete mission tracking with internal/external mission types
- **Approval Workflow**: Multi-level approval system with manager approval required
- **Enhanced Database Schema**: Exception and mission models with complete audit trail
- **Backend API Enhancement**: 8 new endpoints for exception and mission management
- **Frontend Components**: Exception and mission forms with Persian calendar integration
- **Security Dashboard Integration**: Real-time exception and mission tracking
- **Audit Trail**: Complete tracking of approvals, rejections, and decision history
- **Persian Integration**: Full Persian/Farsi support for all exception types
- **TypeScript Fixes**: Resolved all critical TypeScript compilation errors

### Digital Signatures & Mobile Optimization ✅ **COMPLETED**
- **Canvas-based Signature Capture**: Interactive signature component with touch and mouse support
- **Signature Storage & Validation**: Base64 image data storage with format validation
- **Signature Display System**: Modal view for signature verification with employee information
- **Mobile-First Dashboard**: Dedicated mobile interface optimized for security personnel
- **Touch Optimization**: Large touch targets, gesture support, and mobile-friendly interactions
- **Offline Capability**: Service worker with offline data storage and automatic sync
- **Progressive Web App**: PWA manifest with installation support and app-like experience
- **Device Status Monitoring**: Real-time battery level and connection status indicators
- **API Integration**: Complete backend endpoints for signature management with RBAC protection
- **Responsive Design**: Adaptive layout that works seamlessly across all screen sizes

### Enhanced UI Components ✅ **COMPLETED**
- **Advanced Dropdown Component**: Custom `EnhancedDropdown` with search, keyboard navigation, and portal rendering
- **Persian Calendar Enhancements**: Year selection, improved positioning, better UX with `enableYearSelection` prop
- **Enhanced Form Components**: Improved form validation, error handling, and user experience
- **Glass Morphism Design**: Consistent luxury UI with silver, gold, and teal color scheme
- **RTL Support**: Complete right-to-left layout support for Persian/Farsi interface
- **Responsive Design**: Mobile-first approach with adaptive layouts
- **Accessibility**: ARIA labels, keyboard navigation, and screen reader support
- **Performance Optimization**: Efficient rendering with React.memo and useMemo
- **Portal Rendering**: Proper z-index management with React portals
- **Dynamic Positioning**: Smart positioning for dropdowns and modals

### High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Database      │
│   (Next.js)     │◄──►│   (Express.js)  │◄──►│   (PostgreSQL)  │
│   Port: 3000    │    │   Port: 5000    │    │   Port: 5432    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Socket.io     │    │   Redis Cache   │    │   File Storage  │
│   (Real-time)   │    │   Port: 6379   │    │   (Uploads)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🛠️ Technology Stack Details

### Frontend Technologies
- **Next.js 14+**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework with custom Persian/Farsi support
- **React Icons**: Icon library
- **Socket.io Client**: Real-time communication
- **Axios**: HTTP client for API calls
- **js-cookie**: Cookie management
- **Next.js i18n**: Internationalization with Persian/Farsi support
- **React Context**: Theme management (Dark/Light mode)
- **Glass Morphism**: Custom CSS for luxury glass effects
- **Moment-Jalaali**: Persian (Jalali) calendar library with TypeScript support
- **Persian Calendar Components**: Custom interactive calendar components with RTL support

### Backend Technologies
- **Express.js**: Web application framework
- **TypeScript**: Type-safe server development
- **JWT**: Authentication and authorization
- **Socket.io**: Real-time server communication
- **Multer**: File upload handling
- **Prisma**: Database ORM
- **bcryptjs**: Password hashing
- **express-validator**: Input validation
- **express-rate-limit**: API rate limiting
- **helmet**: Security middleware
- **cors**: Cross-origin resource sharing
- **morgan**: HTTP request logger

### Database & Infrastructure
- **PostgreSQL**: Primary database
- **Redis**: Caching and session storage
- **Docker**: Containerization
- **Prisma Migrations**: Database schema management

## 🗄️ Database Schema Design

### Core Tables

#### User Management
```sql
-- Users table
users (
  id: String (Primary Key)
  email: String (Unique)
  username: String (Unique)
  password: String (Hashed)
  firstName: String
  lastName: String
  role: UserRole (ADMIN, USER, MODERATOR, etc.)
  department: String
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)

-- User profiles
profiles (
  id: String (Primary Key)
  userId: String (Foreign Key)
  avatar: String?
  bio: String?
  phone: String?
  address: String?
  city: String?
  country: String?
  createdAt: DateTime
  updatedAt: DateTime
)

-- User roles and permissions
roles (
  id: String (Primary Key)
  name: String
  description: String
  permissions: JSON
  createdAt: DateTime
  updatedAt: DateTime
)
```

#### Financial Management
```sql
-- Chart of accounts
accounts (
  id: String (Primary Key)
  code: String (Unique)
  name: String
  type: AccountType (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE)
  parentId: String? (Foreign Key)
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)

-- Financial transactions
transactions (
  id: String (Primary Key)
  accountId: String (Foreign Key)
  amount: Decimal
  type: TransactionType (DEBIT, CREDIT)
  description: String
  reference: String?
  date: DateTime
  createdAt: DateTime
  updatedAt: DateTime
)

-- Invoices
invoices (
  id: String (Primary Key)
  invoiceNumber: String (Unique)
  customerId: String (Foreign Key)
  amount: Decimal
  taxAmount: Decimal
  totalAmount: Decimal
  status: InvoiceStatus (DRAFT, SENT, PAID, OVERDUE)
  dueDate: DateTime
  createdAt: DateTime
  updatedAt: DateTime
)
```

#### Inventory Management
```sql
-- Products/Stone types
products (
  id: String (Primary Key)
  name: String
  description: String?
  category: String
  unit: String
  costPrice: Decimal
  sellingPrice: Decimal
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)

-- Inventory (encrypted for security)
inventory (
  id: String (Primary Key)
  productId: String (Foreign Key)
  quantity: Decimal
  location: String
  encryptedData: String (Encrypted)
  lastUpdated: DateTime
  createdAt: DateTime
  updatedAt: DateTime
)

-- Warehouse locations
warehouses (
  id: String (Primary Key)
  name: String
  address: String
  type: WarehouseType (EQUIPMENT, TECHNICAL, LOGISTICS)
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)
```

#### Production Management
```sql
-- Work orders
workOrders (
  id: String (Primary Key)
  orderNumber: String (Unique)
  customerId: String (Foreign Key)
  productId: String (Foreign Key)
  quantity: Decimal
  specifications: JSON
  status: WorkOrderStatus (PENDING, IN_PROGRESS, COMPLETED, CANCELLED)
  priority: Priority (LOW, MEDIUM, HIGH, URGENT)
  startDate: DateTime?
  endDate: DateTime?
  createdAt: DateTime
  updatedAt: DateTime
)

-- Production lines
productionLines (
  id: String (Primary Key)
  name: String
  type: ProductionType (CUTTING, CNC)
  capacity: Decimal
  supervisorId: String (Foreign Key)
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)

-- Production schedules
productionSchedules (
  id: String (Primary Key)
  workOrderId: String (Foreign Key)
  productionLineId: String (Foreign Key)
  scheduledStart: DateTime
  scheduledEnd: DateTime
  actualStart: DateTime?
  actualEnd: DateTime?
  status: ScheduleStatus (SCHEDULED, IN_PROGRESS, COMPLETED, DELAYED)
  createdAt: DateTime
  updatedAt: DateTime
)
```

#### Customer Management
```sql
-- Customers
customers (
  id: String (Primary Key)
  name: String
  type: CustomerType (INDIVIDUAL, COMPANY, ARCHITECT, DESIGNER)
  email: String?
  phone: String?
  address: String?
  city: String?
  country: String?
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)

-- Customer projects
projects (
  id: String (Primary Key)
  customerId: String (Foreign Key)
  name: String
  description: String?
  status: ProjectStatus (PLANNING, IN_PROGRESS, COMPLETED, CANCELLED)
  startDate: DateTime?
  endDate: DateTime?
  budget: Decimal?
  createdAt: DateTime
  updatedAt: DateTime
)
```

#### Security Management
```sql
-- Shift management
shifts (
  id: String (Primary Key)
  name: String
  namePersian: String
  startTime: String -- "07:00" | "19:00"
  endTime: String   -- "19:00" | "07:00"
  duration: Int     -- 12 hours
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)

-- Security personnel
securityPersonnel (
  id: String (Primary Key)
  userId: String (Foreign Key, Unique)
  shiftId: String (Foreign Key)
  position: String -- "سرپرست امنیت" | "نگهبان"
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
)

-- Attendance records
attendanceRecords (
  id: String (Primary Key)
  employeeId: String (Foreign Key)
  securityPersonnelId: String (Foreign Key)
  date: DateTime -- Persian calendar date
  shiftId: String (Foreign Key)
  entryTime: String? -- "06:45"
  exitTime: String?  -- "18:22"
  status: AttendanceStatus -- PRESENT, ABSENT, LATE, MISSION, LEAVE
  exceptionType: String? -- "ماموریت" | "مرخصی ساعتی"
  exceptionTime: String? -- "16:10" for missions
  exceptionDuration: Int? -- Hours for leave
  digitalSignature: String?
  notes: String?
  createdAt: DateTime
  updatedAt: DateTime
)

-- Attendance status enum
enum AttendanceStatus {
  PRESENT
  ABSENT
  LATE
  MISSION
  HOURLY_LEAVE
  SICK_LEAVE
  VACATION
}
```

## 🔐 Security Architecture

### Authentication & Authorization
- **JWT Tokens**: Secure authentication
- **Role-Based Access Control (RBAC)**: Granular permissions
- **Session Management**: Secure session handling
- **Password Security**: bcrypt hashing with salt

### Data Security
- **Encryption at Rest**: Database encryption
- **Encryption in Transit**: HTTPS/TLS
- **Sensitive Data Encryption**: Special encryption for inventory data
- **Audit Logging**: Complete transaction logs

### API Security
- **Rate Limiting**: Prevent abuse
- **Input Validation**: Sanitize all inputs
- **CORS Configuration**: Controlled cross-origin access
- **Helmet Security**: Security headers

## 📡 API Design

### RESTful API Endpoints

#### Authentication
```
POST /api/auth/register     - User registration
POST /api/auth/login        - User login
GET  /api/auth/me          - Get current user
POST /api/auth/logout      - User logout
POST /api/auth/refresh     - Refresh token
```

#### User Management
```
GET    /api/users          - Get all users (Admin)
GET    /api/users/:id      - Get user by ID
PUT    /api/users/:id      - Update user
DELETE /api/users/:id      - Delete user (Admin)
POST   /api/users          - Create user (Admin)
```

#### Financial Management
```
GET    /api/accounts        - Get chart of accounts
POST   /api/accounts       - Create account
PUT    /api/accounts/:id   - Update account
GET    /api/transactions   - Get transactions
POST   /api/transactions   - Create transaction
GET    /api/invoices       - Get invoices
POST   /api/invoices       - Create invoice
PUT    /api/invoices/:id   - Update invoice
```

#### Inventory Management
```
GET    /api/products       - Get products
POST   /api/products       - Create product
PUT    /api/products/:id   - Update product
GET    /api/inventory      - Get inventory (encrypted)
POST   /api/inventory      - Update inventory
GET    /api/warehouses     - Get warehouses
POST   /api/warehouses     - Create warehouse
```

#### Production Management
```
GET    /api/work-orders    - Get work orders
POST   /api/work-orders    - Create work order
PUT    /api/work-orders/:id - Update work order
GET    /api/production-lines - Get production lines
POST   /api/production-lines - Create production line
GET    /api/schedules     - Get production schedules
POST   /api/schedules     - Create schedule
```

#### Customer Management
```
GET    /api/customers      - Get customers
POST   /api/customers      - Create customer
PUT    /api/customers/:id  - Update customer
GET    /api/projects       - Get projects
POST   /api/projects       - Create project
PUT    /api/projects/:id   - Update project
```

#### Security Management
```
POST   /api/security/shifts/start        - Start security shift
POST   /api/security/shifts/end          - End security shift
GET    /api/security/shifts              - Get all shifts
POST   /api/security/shifts              - Create shift
PUT    /api/security/shifts/:id          - Update shift
POST   /api/security/attendance/checkin  - Employee check-in
POST   /api/security/attendance/checkout - Employee check-out
POST   /api/security/attendance/exception - Record exception
GET    /api/security/attendance/daily    - Daily attendance report
GET    /api/security/attendance/:id     - Get attendance record
PUT    /api/security/attendance/:id     - Update attendance record
GET    /api/security/dashboard/stats     - Security dashboard stats
GET    /api/security/personnel           - Get security personnel
POST   /api/security/personnel           - Assign security personnel
PUT    /api/security/personnel/:id       - Update security personnel
```

## 🔄 Real-time Features

### Socket.io Events
```javascript
// User events
'user:join'           - User joins system
'user:leave'          - User leaves system
'user:status'         - User status update

// Production events
'production:start'    - Production starts
'production:update'  - Production progress
'production:complete' - Production completed

// Inventory events
'inventory:update'    - Inventory changes
'inventory:alert'     - Low stock alert

// Order events
'order:created'       - New order created
'order:updated'       - Order status update
'order:completed'     - Order completed
```

## 📱 Frontend Architecture

### Component Structure
```
src/
├── app/                 # Next.js App Router
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Home page
│   ├── dashboard/      # Dashboard pages
│   ├── auth/           # Authentication pages
│   └── api/            # API routes
├── components/          # Reusable components
│   ├── ui/             # Glass morphism UI components
│   ├── forms/          # Persian/Farsi form components
│   ├── charts/         # Chart components
│   ├── layout/         # Layout components
│   └── theme/          # Theme components
├── contexts/           # React contexts
│   ├── AuthContext.tsx
│   ├── ThemeContext.tsx
│   └── LanguageContext.tsx
├── hooks/              # Custom hooks
├── lib/                # Utility libraries
├── types/              # TypeScript types
├── styles/             # Global styles
│   ├── globals.css
│   ├── glass-morphism.css
│   └── persian-typography.css
└── locales/            # Internationalization
    ├── fa/             # Persian/Farsi translations
    └── en/             # English translations
```

### State Management
- **React Context**: Global state management
- **Local State**: Component-level state
- **Server State**: API data management
- **Real-time State**: Socket.io integration

## 🚀 Deployment Architecture

### Development Environment
- **Local Development**: Docker Compose
- **Database**: PostgreSQL container
- **Cache**: Redis container
- **File Storage**: Local filesystem

### Production Environment
- **Cloud Hosting**: AWS/Azure/DigitalOcean
- **Database**: Managed PostgreSQL
- **Cache**: Managed Redis
- **File Storage**: Cloud storage (S3/Azure Blob)
- **CDN**: Content delivery network
- **SSL**: HTTPS certificates

## 📊 Performance Requirements

### Response Times
- **API Responses**: < 200ms
- **Page Load**: < 2 seconds
- **Database Queries**: < 100ms
- **Real-time Updates**: < 50ms

### Scalability
- **Concurrent Users**: 1000+
- **Database Connections**: 100+
- **API Requests**: 10,000+ per minute
- **File Storage**: 1TB+

## 🔧 Development Tools

### Code Quality
- **ESLint**: Code linting
- **Prettier**: Code formatting
- **TypeScript**: Type checking
- **Husky**: Git hooks

### Testing
- **Jest**: Unit testing
- **React Testing Library**: Component testing
- **Cypress**: E2E testing
- **Supertest**: API testing

### Monitoring
- **Error Tracking**: Sentry
- **Performance**: New Relic
- **Logging**: Winston
- **Health Checks**: Custom endpoints

---

*This technical specification serves as the blueprint for all development activities.*

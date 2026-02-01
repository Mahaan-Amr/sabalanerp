# Sablan ERP - Database Schema Documentation

## 📋 Overview

This document provides comprehensive documentation for the Sablan ERP database schema. The database uses PostgreSQL with Prisma ORM and follows a workspace-based architecture.

## 🏗️ Database Architecture

### Core Principles
- **Workspace-Based Design**: Tables are organized by workspace functionality
- **Audit Trail**: All tables include `createdAt` and `updatedAt` timestamps
- **Soft Delete**: Critical tables use `deletedAt` for data preservation
- **Foreign Key Relationships**: Proper referential integrity maintained
- **Indexing**: Optimized for common query patterns

## 📊 Core Tables

### 👥 User Management

#### `users` Table
```sql
CREATE TABLE users (
  id                     VARCHAR(25) PRIMARY KEY,
  email                  VARCHAR(255) UNIQUE NOT NULL,
  username               VARCHAR(100) UNIQUE NOT NULL,
  password               VARCHAR(255) NOT NULL,
  firstName              VARCHAR(100) NOT NULL,
  lastName               VARCHAR(100) NOT NULL,
  role                   UserRole DEFAULT 'USER',
  isActive               BOOLEAN DEFAULT true,
  departmentId           VARCHAR(25),
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

**Relationships:**
- `departmentId` → `departments.id`
- One-to-many with `profiles`
- One-to-many with `attendanceRecords`
- One-to-many with `securityPersonnel`

#### `profiles` Table
```sql
CREATE TABLE profiles (
  id                     VARCHAR(25) PRIMARY KEY,
  userId                 VARCHAR(25) UNIQUE NOT NULL,
  avatar                 VARCHAR(500),
  bio                    TEXT,
  phone                  VARCHAR(20),
  address                TEXT,
  city                   VARCHAR(100),
  country                VARCHAR(100),
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `departments` Table
```sql
CREATE TABLE departments (
  id                     VARCHAR(25) PRIMARY KEY,
  name                   VARCHAR(100) NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

## 💼 Sales Workspace Tables

### 📋 Contract Management

#### `salesContracts` Table
```sql
CREATE TABLE salesContracts (
  id                     VARCHAR(25) PRIMARY KEY,
  contractNumber         VARCHAR(50) UNIQUE NOT NULL,
  customerId             VARCHAR(25) NOT NULL,
  salesPersonId          VARCHAR(25),
  status                 ContractStatus DEFAULT 'DRAFT',
  totalAmount            DECIMAL(15,2),
  currency               VARCHAR(10) DEFAULT 'تومان',
  contractData           JSONB,
  workflow               JSONB,
  approvedById           VARCHAR(25),
  signedById             VARCHAR(25),
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

**Relationships:**
- `customerId` → `crmCustomers.id`
- `salesPersonId` → `users.id`
- `approvedById` → `users.id`
- `signedById` → `users.id`

#### `contractItems` Table
```sql
CREATE TABLE contractItems (
  id                     VARCHAR(25) PRIMARY KEY,
  contractId             VARCHAR(25) NOT NULL,
  productId              VARCHAR(25) NOT NULL,
  quantity               DECIMAL(10,2) NOT NULL,
  unitPrice              DECIMAL(15,2) NOT NULL,
  totalPrice             DECIMAL(15,2) NOT NULL,
  description            TEXT,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `deliveries` Table
```sql
CREATE TABLE deliveries (
  id                     VARCHAR(25) PRIMARY KEY,
  contractId             VARCHAR(25) NOT NULL,
  deliveryDate           DATE NOT NULL,
  status                 DeliveryStatus DEFAULT 'SCHEDULED',
  notes                  TEXT,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `payments` Table
```sql
CREATE TABLE payments (
  id                     VARCHAR(25) PRIMARY KEY,
  contractId             VARCHAR(25) NOT NULL,
  paymentMethod          PaymentMethod NOT NULL,
  totalAmount            DECIMAL(15,2) NOT NULL,
  paidAmount             DECIMAL(15,2) DEFAULT 0,
  remainingAmount        DECIMAL(15,2),
  nationalCode           VARCHAR(10),
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

### 📦 Product Management

#### `products` Table
```sql
CREATE TABLE products (
  id                     VARCHAR(25) PRIMARY KEY,
  name                   VARCHAR(200) NOT NULL,
  description            TEXT,
  category               VARCHAR(100),
  unit                   VARCHAR(50),
  costPrice              DECIMAL(15,2),
  sellingPrice           DECIMAL(15,2),
  isActive               BOOLEAN DEFAULT true,
  deletedAt              TIMESTAMP,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

## 👥 CRM Workspace Tables

### 🏢 Customer Management

#### `crmCustomers` Table
```sql
CREATE TABLE crmCustomers (
  id                     VARCHAR(25) PRIMARY KEY,
  firstName              VARCHAR(100) NOT NULL,
  lastName               VARCHAR(100) NOT NULL,
  customerType           CustomerType DEFAULT 'Individual',
  nationalCode           VARCHAR(10),
  homeAddress            TEXT,
  homeNumber             VARCHAR(20),
  workAddress            TEXT,
  workNumber             VARCHAR(20),
  projectManagerName     VARCHAR(100),
  projectManagerNumber   VARCHAR(20),
  brandName              VARCHAR(100),
  brandNameDescription   TEXT,
  isBlacklisted          BOOLEAN DEFAULT false,
  isLocked               BOOLEAN DEFAULT false,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `projectAddresses` Table
```sql
CREATE TABLE projectAddresses (
  id                     VARCHAR(25) PRIMARY KEY,
  customerId             VARCHAR(25) NOT NULL,
  projectName            VARCHAR(200) NOT NULL,
  projectAddress         TEXT NOT NULL,
  projectCity            VARCHAR(100),
  projectType            VARCHAR(100),
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `phoneNumbers` Table
```sql
CREATE TABLE phoneNumbers (
  id                     VARCHAR(25) PRIMARY KEY,
  customerId             VARCHAR(25) NOT NULL,
  phoneNumber            VARCHAR(20) NOT NULL,
  isPrimary              BOOLEAN DEFAULT false,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `crmContacts` Table
```sql
CREATE TABLE crmContacts (
  id                     VARCHAR(25) PRIMARY KEY,
  customerId             VARCHAR(25) NOT NULL,
  firstName              VARCHAR(100) NOT NULL,
  lastName               VARCHAR(100) NOT NULL,
  position               VARCHAR(100),
  email                  VARCHAR(255),
  phone                  VARCHAR(20),
  mobile                 VARCHAR(20),
  isPrimary              BOOLEAN DEFAULT false,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

## 📦 Inventory Workspace Tables

### 🏗️ Master Data Management

#### `cutTypes` Table
```sql
CREATE TABLE cutTypes (
  id                     VARCHAR(25) PRIMARY KEY,
  namePersian            VARCHAR(100) NOT NULL,
  nameEnglish            VARCHAR(100),
  code                   VARCHAR(20) UNIQUE NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `stoneMaterials` Table
```sql
CREATE TABLE stoneMaterials (
  id                     VARCHAR(25) PRIMARY KEY,
  namePersian            VARCHAR(100) NOT NULL,
  nameEnglish            VARCHAR(100),
  code                   VARCHAR(20) UNIQUE NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `cutWidths` Table
```sql
CREATE TABLE cutWidths (
  id                     VARCHAR(25) PRIMARY KEY,
  namePersian            VARCHAR(100) NOT NULL,
  nameEnglish            VARCHAR(100),
  code                   VARCHAR(20) UNIQUE NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `thicknesses` Table
```sql
CREATE TABLE thicknesses (
  id                     VARCHAR(25) PRIMARY KEY,
  namePersian            VARCHAR(100) NOT NULL,
  nameEnglish            VARCHAR(100),
  code                   VARCHAR(20) UNIQUE NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `mines` Table
```sql
CREATE TABLE mines (
  id                     VARCHAR(25) PRIMARY KEY,
  namePersian            VARCHAR(100) NOT NULL,
  nameEnglish            VARCHAR(100),
  code                   VARCHAR(20) UNIQUE NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `finishTypes` Table
```sql
CREATE TABLE finishTypes (
  id                     VARCHAR(25) PRIMARY KEY,
  namePersian            VARCHAR(100) NOT NULL,
  nameEnglish            VARCHAR(100),
  code                   VARCHAR(20) UNIQUE NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `colors` Table
```sql
CREATE TABLE colors (
  id                     VARCHAR(25) PRIMARY KEY,
  namePersian            VARCHAR(100) NOT NULL,
  nameEnglish            VARCHAR(100),
  code                   VARCHAR(20) UNIQUE NOT NULL,
  description            TEXT,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

## 🔒 Security Workspace Tables

### ⏰ Shift Management

#### `shifts` Table
```sql
CREATE TABLE shifts (
  id                     VARCHAR(25) PRIMARY KEY,
  name                   VARCHAR(50) NOT NULL,
  namePersian            VARCHAR(50) NOT NULL,
  startTime              VARCHAR(5) NOT NULL,
  endTime                VARCHAR(5) NOT NULL,
  duration               INTEGER NOT NULL,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `securityPersonnel` Table
```sql
CREATE TABLE securityPersonnel (
  id                     VARCHAR(25) PRIMARY KEY,
  userId                 VARCHAR(25) UNIQUE NOT NULL,
  shiftId                VARCHAR(25) NOT NULL,
  position               VARCHAR(100) NOT NULL,
  isActive               BOOLEAN DEFAULT true,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

### 📅 Attendance Management

#### `attendanceRecords` Table
```sql
CREATE TABLE attendanceRecords (
  id                     VARCHAR(25) PRIMARY KEY,
  employeeId             VARCHAR(25) NOT NULL,
  securityPersonnelId    VARCHAR(25) NOT NULL,
  date                   DATE NOT NULL,
  shiftId                VARCHAR(25) NOT NULL,
  entryTime              VARCHAR(5),
  exitTime               VARCHAR(5),
  status                 AttendanceStatus DEFAULT 'PRESENT',
  exceptionType          VARCHAR(50),
  exceptionTime          VARCHAR(5),
  exceptionDuration      INTEGER,
  digitalSignature       TEXT,
  notes                  TEXT,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

### 🚨 Exception Management

#### `exceptionRequests` Table
```sql
CREATE TABLE exceptionRequests (
  id                     VARCHAR(25) PRIMARY KEY,
  employeeId             VARCHAR(25) NOT NULL,
  exceptionType          ExceptionType NOT NULL,
  startDate              DATE NOT NULL,
  endDate                DATE,
  startTime              VARCHAR(5),
  endTime                VARCHAR(5),
  duration               INTEGER,
  reason                 TEXT NOT NULL,
  status                 ExceptionStatus DEFAULT 'PENDING',
  approvedById           VARCHAR(25),
  rejectedById           VARCHAR(25),
  approvedAt             TIMESTAMP,
  rejectedAt             TIMESTAMP,
  rejectionReason        TEXT,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `missionAssignments` Table
```sql
CREATE TABLE missionAssignments (
  id                     VARCHAR(25) PRIMARY KEY,
  employeeId             VARCHAR(25) NOT NULL,
  assignerId             VARCHAR(25) NOT NULL,
  missionType            MissionType NOT NULL,
  location               VARCHAR(200),
  purpose                TEXT NOT NULL,
  startDate              DATE NOT NULL,
  endDate                DATE,
  startTime              VARCHAR(5),
  endTime                VARCHAR(5),
  status                 MissionStatus DEFAULT 'PENDING',
  approvedById           VARCHAR(25),
  approvedAt             TIMESTAMP,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

## 🔐 Permission Management Tables

### 🏢 Workspace Permissions

#### `workspacePermissions` Table
```sql
CREATE TABLE workspacePermissions (
  id                     VARCHAR(25) PRIMARY KEY,
  userId                 VARCHAR(25) NOT NULL,
  workspace              VARCHAR(50) NOT NULL,
  permissionLevel        PermissionLevel NOT NULL,
  grantedById            VARCHAR(25) NOT NULL,
  expiresAt              TIMESTAMP,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

#### `featurePermissions` Table
```sql
CREATE TABLE featurePermissions (
  id                     VARCHAR(25) PRIMARY KEY,
  userId                 VARCHAR(25) NOT NULL,
  workspace              VARCHAR(50) NOT NULL,
  feature                VARCHAR(100) NOT NULL,
  permissionLevel        PermissionLevel NOT NULL,
  grantedById            VARCHAR(25) NOT NULL,
  expiresAt              TIMESTAMP,
  createdAt              TIMESTAMP DEFAULT NOW(),
  updatedAt              TIMESTAMP DEFAULT NOW()
);
```

## 📊 Enums

### User Roles
```sql
CREATE TYPE UserRole AS ENUM (
  'ADMIN',
  'USER',
  'MODERATOR'
);
```

### Contract Status
```sql
CREATE TYPE ContractStatus AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SIGNED',
  'PRINTED',
  'CANCELLED',
  'EXPIRED'
);
```

### Customer Types
```sql
CREATE TYPE CustomerType AS ENUM (
  'Individual',
  'Company',
  'Government'
);
```

### Payment Methods
```sql
CREATE TYPE PaymentMethod AS ENUM (
  'CASH',
  'RECEIPT_BASED',
  'CHECK'
);
```

### Attendance Status
```sql
CREATE TYPE AttendanceStatus AS ENUM (
  'PRESENT',
  'ABSENT',
  'LATE',
  'MISSION',
  'HOURLY_LEAVE',
  'SICK_LEAVE',
  'VACATION'
);
```

### Exception Types
```sql
CREATE TYPE ExceptionType AS ENUM (
  'MISSION',
  'HOURLY_LEAVE',
  'SICK_LEAVE',
  'VACATION',
  'ABSENCE',
  'EMERGENCY_LEAVE',
  'PERSONAL_LEAVE'
);
```

### Permission Levels
```sql
CREATE TYPE PermissionLevel AS ENUM (
  'VIEW',
  'EDIT',
  'ADMIN'
);
```

## 🔍 Indexes

### Performance Indexes
```sql
-- User indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_department ON users(departmentId);

-- Contract indexes
CREATE INDEX idx_sales_contracts_customer ON salesContracts(customerId);
CREATE INDEX idx_sales_contracts_status ON salesContracts(status);
CREATE INDEX idx_sales_contracts_number ON salesContracts(contractNumber);

-- Customer indexes
CREATE INDEX idx_crm_customers_name ON crmCustomers(firstName, lastName);
CREATE INDEX idx_crm_customers_national_code ON crmCustomers(nationalCode);
CREATE INDEX idx_crm_customers_type ON crmCustomers(customerType);

-- Attendance indexes
CREATE INDEX idx_attendance_employee_date ON attendanceRecords(employeeId, date);
CREATE INDEX idx_attendance_date ON attendanceRecords(date);
CREATE INDEX idx_attendance_status ON attendanceRecords(status);

-- Permission indexes
CREATE INDEX idx_workspace_permissions_user ON workspacePermissions(userId);
CREATE INDEX idx_feature_permissions_user ON featurePermissions(userId);
```

## 🔄 Relationships Summary

### Key Relationships
- **Users** → **Departments** (Many-to-One)
- **Users** → **Security Personnel** (One-to-One)
- **Sales Contracts** → **CRM Customers** (Many-to-One)
- **Contract Items** → **Products** (Many-to-One)
- **Project Addresses** → **CRM Customers** (Many-to-One)
- **Phone Numbers** → **CRM Customers** (Many-to-One)
- **Attendance Records** → **Users** (Many-to-One)
- **Exception Requests** → **Users** (Many-to-One)

## 📈 Data Volume Estimates

### Expected Record Counts
- **Users**: 50-100 records
- **Sales Contracts**: 1,000-5,000 records/year
- **CRM Customers**: 500-2,000 records
- **Products**: 500-1,000 records
- **Attendance Records**: 10,000-50,000 records/year
- **Exception Requests**: 100-500 records/year

## 🔒 Security Considerations

### Data Protection
- **Password Hashing**: bcrypt with salt
- **JWT Tokens**: Secure authentication
- **Role-Based Access**: Granular permissions
- **Audit Trail**: Complete change tracking
- **Soft Delete**: Data preservation

### Backup Strategy
- **Daily Backups**: Automated PostgreSQL dumps
- **Point-in-Time Recovery**: WAL archiving
- **Cross-Region Replication**: Disaster recovery
- **Data Retention**: 7 years for financial data

---

**Last Updated**: January 20, 2025  
**Version**: 1.0  
**Owner**: Development Team

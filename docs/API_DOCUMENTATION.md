# Sablan ERP - API Documentation

## 📋 Overview

This document provides comprehensive documentation for all API endpoints in the Sablan ERP system. The API follows RESTful conventions and is organized by workspace-specific routes.

## 🔐 Authentication

All API endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

## 🏗️ Workspace-Specific API Endpoints

### 🔐 Authentication Endpoints (`/api/auth`)

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| POST | `/api/auth/register` | Create a new user account | `email`, `username`, `password`, `firstName`, `lastName` |
| POST | `/api/auth/login` | Authenticate an existing user | `email`, `password` |
| GET | `/api/auth/me` | Retrieve the authenticated user profile | – |

### 👥 User Management (`/api/users/`)

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|------------|
| GET | `/api/users` | Get all users (Admin) | `page`, `limit`, `search` |
| GET | `/api/users/:id` | Get user by ID | - |
| POST | `/api/users` | Create user (Admin) | User data |
| PUT | `/api/users/:id` | Update user | User data |
| DELETE | `/api/users/:id` | Delete user (Admin) | - |

### 🏢 Department Management (`/api/departments/`)

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|------------|
| GET | `/api/departments` | Get all departments | - |
| POST | `/api/departments` | Create department | Department data |
| PUT | `/api/departments/:id` | Update department | Department data |
| DELETE | `/api/departments/:id` | Delete department | - |

### 🔐 Permissions Management (`/api/permissions/`)

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|------------|
| GET | `/api/permissions/features` | Get all features | - |
| GET | `/api/permissions/role-features` | Get role feature permissions | - |
| GET | `/api/permissions/user/:userId/features` | Get user feature permissions | - |
| POST | `/api/permissions/features` | Create feature permission | Permission data |
| PUT | `/api/permissions/features/:id` | Update feature permission | Permission data |
| DELETE | `/api/permissions/features/:id` | Delete feature permission | - |

### 🏢 Workspace Permissions (`/api/workspace-permissions/`)

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|------------|
| GET | `/api/workspace-permissions` | Get workspace permissions | - |
| GET | `/api/workspace-permissions/user-workspaces` | Get user workspaces | - |
| POST | `/api/workspace-permissions` | Create workspace permission | Permission data |
| PUT | `/api/workspace-permissions/:id` | Update workspace permission | Permission data |
| DELETE | `/api/workspace-permissions/:id` | Delete workspace permission | - |

## 💼 Sales Workspace API (`/api/sales`)

### 📋 Contract Management

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| GET | `/api/sales/contracts/next-number` | Generate the next contract number with gap detection | – |
| GET | `/api/sales/contracts` | Paginated list of contracts | `page`, `limit`, `status`, `departmentId` |
| GET | `/api/sales/contracts/:id` | Retrieve a single contract with customer, department, and template info | – |
| POST | `/api/sales/contracts` | Create a new contract (auto numbers on create) | `title`, `titlePersian`, `customerId`, `departmentId`, `content`, optional pricing metadata |
| PUT | `/api/sales/contracts/:id` | Update editable contract fields | Partial contract payload |
| DELETE | `/api/sales/contracts/:id` | Soft-delete a contract | – |
| PUT | `/api/sales/contracts/:id/approve` | Approve a contract | Optional `note` |
| PUT | `/api/sales/contracts/:id/reject` | Reject a contract | Optional `note` |
| PUT | `/api/sales/contracts/:id/sign` | Mark a contract as signed | Optional `note` |
| PUT | `/api/sales/contracts/:id/print` | Mark a contract as printed/generate printable HTML | Optional `note` |
| POST | `/api/sales/contracts/:contractId/items` | Add contract line items tied to products | `productId`, quantity, pricing |

### 🚚 Deliveries & Payments

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| GET | `/api/sales/contracts/:contractId/deliveries` | List scheduled deliveries for a contract | – |
| POST | `/api/sales/contracts/:contractId/deliveries` | Register delivery progress | Delivery payload (dates, quantities, status) |
| GET | `/api/sales/contracts/:contractId/payments` | List recorded payments for a contract | – |
| POST | `/api/sales/contracts/:contractId/payments` | Record a payment against a contract | Payment payload (amount, method, reference) |

### 📊 Sales Dashboard

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| GET | `/api/sales/dashboard/stats` | Aggregated KPIs for the Sales workspace | – |
| GET | `/api/sales/dashboard` | Widget feed (top performers, pipeline metrics) | – |

### 📦 Product Catalog (`/api/products`)

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| GET | `/api/products` | Paginated product catalog with filtering | Query params (`page`, `limit`, `search`, `category`, etc.) |
| GET | `/api/products/:id` | Retrieve a single product | – |
| GET | `/api/products/code/:code` | Look up a product by internal code | – |
| POST | `/api/products` | Create a new product definition | Product payload with pricing & dimension metadata |
| PUT | `/api/products/:id` | Update product metadata | Partial payload |
| DELETE | `/api/products/:id` | Soft-delete a product | – |
| GET | `/api/products/attributes` | Enumerations used by the product form | – |
| GET | `/api/products/template` | Download the Excel import template | – |
| POST | `/api/products/import` | Bulk import from Excel | `multipart/form-data` with `file` |
| GET | `/api/products/export` | Export current filter set to Excel | Query params mirror list filters |

## 👥 CRM Workspace API (`/api/crm`)

### 🏢 Customer Management

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| GET | `/api/crm/customers` | Paginated customers with filters | `page`, `limit`, `search`, `status`, `customerType` |
| GET | `/api/crm/customers/:id` | Customer with contacts, phones, addresses | – |
| POST | `/api/crm/customers` | Create a CRM customer | Company/contact payload |
| PUT | `/api/crm/customers/:id` | Update customer metadata | Partial customer payload |
| PUT | `/api/crm/customers/:id/blacklist` | Toggle blacklist flag | – |
| PUT | `/api/crm/customers/:id/lock` | Toggle lock flag | – |

### 📍 Project Addresses

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| POST | `/api/crm/customers/:customerId/project-addresses` | Add project/job site metadata | Address payload |
| PUT | `/api/crm/customers/:customerId/project-addresses/:projectId` | Update project address | Address payload |

### ☎️ Phone Numbers

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| POST | `/api/crm/customers/:customerId/phone-numbers` | Add phone record (primary toggle supported) | `number`, `type`, `isPrimary` |

### 👤 Contacts

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| POST | `/api/crm/customers/:customerId/contacts` | Add a customer contact | `firstName`, `lastName`, `position`, etc. |

### 🎯 Lead Management

| Method | Endpoint | Description | Body/Query |
|--------|----------|-------------|------------|
| GET | `/api/crm/leads` | Paginated list of CRM leads | `page`, `limit`, `status`, `source` |
| POST | `/api/crm/leads` | Create a lead | Lead payload (companyName, contactName, etc.) |
| PUT | `/api/crm/leads/:id` | Update lead status/details | Partial payload |

> ℹ️ Communications and contact CRUD endpoints referenced in the frontend client are not yet implemented on the backend. Any new documentation should be added only after those routes exist.

## 📦 Inventory Workspace API (`/api/inventory`)

Each master-data resource follows the same CRUD pattern. All routes are workspace-protected and accept pagination filters where noted.

| Resource | GET (list) | POST (create) | PUT (update) | DELETE (soft delete) | Notes |
|----------|------------|---------------|--------------|----------------------|-------|
| Cut Types | `/inventory/cut-types` | `/inventory/cut-types` | `/inventory/cut-types/:id` | `/inventory/cut-types/:id` | Filters: `page`, `limit`, `search`, `isActive` |
| Stone Materials | `/inventory/stone-materials` | `/inventory/stone-materials` | `/inventory/stone-materials/:id` | `/inventory/stone-materials/:id` | Tracks quarry info & physical traits |
| Cut Widths | `/inventory/cut-widths` | `/inventory/cut-widths` | `/inventory/cut-widths/:id` | `/inventory/cut-widths/:id` | Width presets for production |
| Thicknesses | `/inventory/thicknesses` | `/inventory/thicknesses` | `/inventory/thicknesses/:id` | `/inventory/thicknesses/:id` | Includes mm-based enumerations |
| Mines | `/inventory/mines` | `/inventory/mines` | `/inventory/mines/:id` | `/inventory/mines/:id` | Stores mine location metadata |
| Finish Types | `/inventory/finish-types` | `/inventory/finish-types` | `/inventory/finish-types/:id` | `/inventory/finish-types/:id` | Polished, honed, etc. |
| Colors | `/inventory/colors` | `/inventory/colors` | `/inventory/colors/:id` | `/inventory/colors/:id` | RGB/hex metadata backed by Prisma |

## 🔒 Security Workspace API (`/api/security`)

### ⏰ Shift Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/security/shifts` | List configured day/night shifts |
| POST | `/api/security/shifts` | Create a shift definition |
| POST | `/api/security/shifts/start` | Mark the authenticated guard’s shift as started |
| POST | `/api/security/shifts/end` | End the current shift for the guard |

### 📅 Attendance

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/security/attendance/checkin` | Record employee check-in (with Jalali time defaults) |
| POST | `/api/security/attendance/checkout` | Record check-out |
| POST | `/api/security/attendance/exception` | Submit an attendance exception (hourly leave, sick, etc.) |
| GET | `/api/security/attendance/daily` | Daily attendance report with filters |
| PUT | `/api/security/attendance/:id/signature` | Attach a signature to an attendance record |
| GET | `/api/security/attendance/:id/signature` | Retrieve stored signature data |

### 👥 Security Personnel

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/security/personnel` | Admin-only list of personnel assignments |
| POST | `/api/security/personnel` | Assign/activate personnel |

### 🚨 Exceptions & Missions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/security/exceptions/request` | Submit a new exception request |
| GET | `/api/security/exceptions/requests` | Admin review queue |
| PUT | `/api/security/exceptions/:id/approve` | Approve exception |
| PUT | `/api/security/exceptions/:id/reject` | Reject exception |
| POST | `/api/security/missions/assign` | Create a mission assignment |
| GET | `/api/security/missions` | View mission list with filters |
| PUT | `/api/security/missions/:id/approve` | Approve/confirm mission execution |

### 📊 Security Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/security/dashboard/stats` | KPIs for shifts, missions, exceptions |
| POST | `/api/security/signature/validate` | Validate a submitted signature blob |

## 📊 Dashboard API (`/api/dashboard`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/stats` | Contract/customer KPIs derived from Prisma |
| GET | `/api/dashboard/profile` | Authenticated user profile with workspace + feature permissions |

## 📋 Contract Templates API (`/api/contract-templates/`)

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|------------|
| GET | `/api/contract-templates` | Get all templates | - |
| GET | `/api/contract-templates/:id` | Get template by ID | - |
| POST | `/api/contract-templates` | Create template | Template data |
| PUT | `/api/contract-templates/:id` | Update template | Template data |
| DELETE | `/api/contract-templates/:id` | Delete template | - |

## 📊 Response Formats

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Paginated Response
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "pages": 10
  }
}
```

## 🔒 Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Authentication required |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Input validation failed |
| `INTERNAL_ERROR` | Server error |

## 📝 Notes

- All timestamps are in ISO 8601 format
- All monetary values are in Rial (IRR) unless specified
- Persian/Farsi text is supported in all text fields
- File uploads are limited to 10MB per file
- Rate limiting: 100 requests per minute per user

---

**Last Updated**: November 17, 2025  
**Version**: 1.1  
**Owner**: Development Team

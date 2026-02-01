# Sablan ERP - Project Overview

## 🏢 Project Information

**Project Name**: Sablan ERP  
**Target Company**: Sablan Stone  
**Industry**: Natural Stone Manufacturing & Processing  
**Established**: 2008 (16+ years in business)  
**Location**: Iran  
**Business Model**: B2B Stone Industry ERP Solution  
**Current Status**: In Progress – Sales, CRM, Inventory, Security live; HR & Accounting pending  

## 🎯 Project Vision

To create a comprehensive, secure, and industry-specific ERP system tailored for Sablan Stone's complex organizational structure, addressing the unique challenges of stone manufacturing and processing operations. The system will feature a luxury Persian/Farsi interface with glass morphism design, supporting both dark and light modes with a sophisticated silver, gold, and teal color scheme.

## 🏗️ Current Architecture Status

**Workspace-Based Architecture**: Modular workspace design with role- and feature-based access. Current delivery status:
- **Sales Workspace** – ✅ Contract lifecycle, PDF output, deliveries & payments
- **CRM Workspace** – ✅ Customer + lead management (contact/phone CRUD pending)
- **Inventory Workspace** – ✅ Master data catalogs (no stock ledger yet)
- **Security Workspace** – ✅ Attendance, missions, signature capture
- **Admin & Permissions** – ✅ User management, workspace + feature RBAC
- **HR Workspace** – 🚧 Not yet implemented
- **Accounting Workspace** – 🚧 Not yet implemented

**Current Progress** (Nov 17, 2025):
- Architecture foundation & shared services – 100% ✅
- Sales workspace – 95% (live, minor enhancements queued)
- CRM workspace – 80% (communications/phones editing pending)
- Inventory workspace – 85% (master data done, stock ops scheduled)
- Security workspace – 90% (reporting phase outstanding)
- HR workspace – 0% (not started)
- Accounting workspace – 0% (not started)
- Enhanced UI components – 100% ✅

### ✅ Completed Major Features (as of Nov 2025)
- **Workspace Architecture**: Modular workspaces with combined role + workspace permissions
- **Sales Workspace**: 7-step contract wizard, contract lifecycle actions, deliveries/payments, PDF export
- **CRM Workspace**: Customer CRUD, project addresses, phone numbers (create), lead pipeline, blacklist/lock workflows
- **Contract-CRM Integration**: Contract forms linked to CRM customers/products with in-app preview
- **Product Catalog System**: Excel import/export, attribute metadata, stats dashboard
- **Inventory Master Data**: CRUD for cut types, stone materials, dimensions, finish types, mines, and colors
- **Security Management**: Shift scheduling, digital attendance, exception & mission workflows, signature capture
- **Admin & Permissions**: User management with granular workspace + feature access
- **Enhanced UI Components**: Advanced dropdowns, Jalali calendar utilities, luxury RTL interface
- **Persian/Farsi Support**: System-wide RTL layout, Persian typography, localized numerals
- **API Architecture**: Express + Prisma services with JWT auth, socket hooks, and validation layers
- **Frontend Components**: Workspace context/provider, navigation shell, dashboard widgets

## 🏗️ Company Structure Analysis

### Organizational Departments:
1. **Security & Administration** (انتظامات)
   - Day Shift: Security and protection services
   - Night Shift: Guard services

2. **Finance & Accounting** (مالی و حساب داری)
   - Accounting Supervisor
   - Financial Accounting
   - Tax Accounting
   - Sales Accounting

3. **Warehouse Management** (انبار)
   - Equipment Warehouse
   - Technical & Equipment
   - Logistics (Inbound/Outbound)
   - Driver Management

4. **Customer Affairs** (امور مشتریان)
   - Reception
   - CRM
   - Media

5. **Sales & Marketing** (فروش و بازاریابی)
   - Field Marketing
   - Telephone Marketing
   - In-Person Sales
   - CNC & Tools Sales (Architects & Designers)

6. **Workshop Operations** (کارگاه)
   - Cutting Workshop (Supervisor + Team)
   - CNC Workshop (Supervisor + Team)

7. **Management Integration**
   - Shared section between Warehouse, Finance, and Accounting

8. **Procurement** (کارپرداز)
   - Limited information available

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS with custom Persian/Farsi support
- **UI Components**: Custom luxury glass morphism components with React Icons
- **State Management**: React hooks (useState, useEffect, useContext)
- **Real-time Communication**: Socket.io client
- **Build Tool**: Next.js built-in bundler
- **Internationalization**: Next.js i18n with Persian/Farsi support
- **Theme System**: Dark/Light mode with silver/gold/teal color scheme

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Authentication**: JWT (JSON Web Tokens)
- **API Design**: RESTful APIs
- **Real-time Communication**: Socket.io server
- **File Processing**: Multer (for file uploads)

### Database & ORM
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Database Migrations**: Prisma migrations
- **Connection Pooling**: Prisma's built-in connection pooling

## 🎯 Key Business Requirements

### Critical Features
1. **Security-First Approach**: Encrypted inventory management due to security concerns
2. **Multi-Level Management**: Supervisors, teams, departments
3. **Production Complexity**: Cutting + CNC operations management
4. **Sales Diversity**: Multiple sales channels and customer types
5. **Financial Integration**: Multiple accounting functions
6. **Real-time Operations**: Live updates for production and logistics

### Business Challenges
- **Security Concerns**: Inventory visibility restrictions
- **Multi-Departmental Operations**: Complex workflows
- **Production Management**: Dual workshop operations
- **Customer Relations**: Multiple touchpoints and specialized sales
- **Financial Complexity**: Multi-level accounting requirements

## 🚀 Project Goals

### Primary Objectives
1. **Streamline Operations**: Automate and optimize business processes
2. **Enhance Security**: Implement robust security measures
3. **Improve Efficiency**: Reduce manual work and errors
4. **Enable Growth**: Scalable solution for business expansion
5. **Ensure Compliance**: Meet industry and regulatory requirements

### Success Metrics
- **System Uptime**: 99.9%
- **Response Time**: <2 seconds
- **Security**: Zero security breaches
- **User Adoption**: 90%+ within 6 months
- **Process Efficiency**: 30% improvement
- **Data Accuracy**: 99%+ accuracy
- **Cost Reduction**: 20% operational cost savings
- **Customer Satisfaction**: 95%+ satisfaction rate

## 📊 Market Positioning

### Competitive Advantages
- **Industry-Specific**: Tailored for stone manufacturing
- **Local Market Knowledge**: Understanding of Iranian stone industry
- **Modern Technology**: Next.js, real-time updates, mobile-ready
- **Cost-Effective**: More affordable than enterprise solutions
- **Security-Focused**: Addresses specific security concerns

### Target Market
- **Primary**: Soblan Stone (Internal use)
- **Secondary**: Other stone manufacturing companies in Iran
- **Future**: Regional stone industry expansion
- **Language**: Persian/Farsi interface for Iranian market
- **Design**: Luxury glass morphism for premium positioning

## 🔒 Security Considerations

### Critical Security Requirements
- **Inventory Security**: Encrypted inventory data due to security concerns
- **Access Control**: Role-based permissions
- **Audit Trails**: Complete transaction logging
- **Data Encryption**: Secure data transmission and storage
- **Compliance**: Meet industry security standards

## 📈 Future Expansion Plans

### Phase 1: Internal Implementation
- **Sales Management Priority**: Focus on digitizing paper contracts
- **Contract Management**: Digital contract creation, printing, and management
- **Sales Process**: Complete sales workflow digitization
- **User Training**: Sales team training and adoption

### Phase 2: Department Rollout
- Security & Administration (انتظامات)
- Finance & Accounting (مالی و حساب داری)
- Warehouse Management (انبار) - In/Out tracking only
- Production Management (کارگاه)

### Phase 3: Market Expansion
- Package solution for other stone companies
- Multi-tenant architecture
- Regional market penetration

---

## 🚀 Current Project Status (Updated: November 17, 2025)

### ✅ Completed / Live
- **Core Infrastructure**: Next.js 14 app router, Express/Prisma API, Socket.io, Dockerized DB
- **Authentication & RBAC**: JWT auth, workspace permissions, feature-level gating, audit-friendly APIs
- **UI System**: RTL glass-morphism design system, dual themes, reusable workspace shell
- **Sales Management Core**: Contract wizard, numbering, lifecycle actions, deliveries & payments, PDF output
- **CRM Core**: Customer/lead CRUD, blacklist & lock flows, ancillary project/phone records
- **Security Workspace**: Shift scheduling, attendance, exception & mission workflows, signature capture PWA
- **Inventory Master Data**: Master catalogs for all slab attributes leveraged by Sales + Production
- **Admin Tooling**: Departments, workspace permissions, feature permissions, dashboard stats/profile APIs

### 🔒 Security Management System ✅ **CORE COMPLETED**
- **Database Schema**: Complete security models (Shift, SecurityPersonnel, AttendanceRecord)
- **Backend API**: 15+ endpoints for shift management, attendance tracking, personnel management
- **Frontend Dashboard**: Persian/Farsi security dashboard with real-time monitoring
- **Shift Management**: Day/Night shift system (7AM-7PM, 7PM-7AM) with automatic assignment
- **Attendance Tracking**: Digital check-in/check-out system replacing manual "دفتر حضور و غیاب"
- **Security Personnel**: Role-based assignment with department permissions
- **Dashboard Integration**: Security navigation added to main dashboard
- **Database Seeding**: Default shifts created, admin assigned as security supervisor
- **API Integration**: Complete frontend API client with all security endpoints
- **Real-time Features**: Live attendance monitoring and status updates

### 📅 Persian Calendar Integration ✅ **COMPLETED**
- **Persian Calendar Utility**: Comprehensive `PersianCalendar` class with full Jalali calendar support
- **Interactive Calendar Component**: Reusable `PersianCalendarComponent` with Persian month/day names
- **System-wide Integration**: All date displays updated to use Persian calendar formatting
- **Security Dashboard Enhancement**: Persian date picker for attendance filtering with real-time updates
- **Date Conversion**: Gregorian ↔ Persian (Jalali) conversion using `moment-jalaali` library
- **Persian Formatting**: Persian month names (فروردین، اردیبهشت، ...) and day names (یکشنبه، دوشنبه، ...)
- **Backend Compatibility**: Security API updated to handle Persian date conversions and filtering
- **TypeScript Support**: Full type safety with `@types/moment-jalaali` integration
- **RTL Layout**: Proper right-to-left layout for Persian calendar interface
- **Performance**: Optimized date operations and efficient calendar rendering

### 🔒 Exception Handling System ✅ **COMPLETED**
- **Exception Request Management**: Comprehensive leave request system supporting hourly leave, sick leave, vacation, emergency leave, and personal leave
- **Mission Assignment System**: Complete mission tracking with internal/external mission types, location tracking, and purpose documentation
- **Approval Workflow**: Multi-level approval system with manager approval required for all exceptions and missions
- **Enhanced Database Schema**: Exception and mission models with complete audit trail and status tracking
- **Backend API Enhancement**: 8 new endpoints for exception and mission management with full CRUD operations
- **Frontend Components**: Exception and mission forms with Persian calendar integration and comprehensive validation
- **Security Dashboard Integration**: Real-time exception and mission tracking with status indicators and modal forms
- **Audit Trail**: Complete tracking of approvals, rejections, and decision history with timestamps and reasons
- **Persian Integration**: Full Persian/Farsi support for all exception types and mission categories
- **TypeScript Fixes**: Resolved all critical TypeScript compilation errors for production readiness

### 🔒 Digital Signatures & Mobile Optimization ✅ **COMPLETED**
- **Canvas-based Signature Capture**: Interactive signature component with touch and mouse support for attendance verification
- **Signature Storage & Validation**: Base64 image data storage with format validation and authenticity checks
- **Signature Display System**: Modal view for signature verification with employee and timestamp information
- **Mobile-First Dashboard**: Dedicated mobile interface optimized for security personnel field use
- **Touch Optimization**: Large touch targets, gesture support, and mobile-friendly interactions
- **Offline Capability**: Service worker with offline data storage and automatic sync when online
- **Progressive Web App**: PWA manifest with installation support and app-like experience
- **Device Status Monitoring**: Real-time battery level and connection status indicators
- **API Integration**: Complete backend endpoints for signature management with RBAC protection
- **Responsive Design**: Adaptive layout that works seamlessly across all screen sizes

### 🔄 Security System - Next Phase
- **Reporting System**: Daily/weekly attendance reports with PDF/Excel export functionality
- **Advanced Analytics**: Attendance trends, exception patterns, and security insights
- **Integration Enhancements**: Enhanced notification system and audit logging

### 🔄 In Progress
- **CRM Enhancements**: Contact editing/deletion, communications log, phone editing
- **Inventory Roadmap**: Stock intake/outbound tracking layered on top of master data
- **Security Reporting**: PDF/Excel exports for attendance & missions
- **Testing & QA**: Broader automated coverage and load/perf tuning
- **Documentation Updates**: Align docs with Nov 2025 codebase (this effort)

### 📋 Next Priorities (Updated Priority Order)
- **👥 HR Workspace Kickoff**: Core employee profiles, contracts, attendance integration
- **💰 Accounting Workspace Foundations**: Chart of accounts, invoicing, payment reconciliation
- **📦 Inventory Operations**: Stock entries, reservations, integration with sales deliveries
- **🧾 Reporting Layer**: Unified KPIs + exports across workspaces
- **📞 Marketing Modules**: Telephone & in-person sales tooling once CRM gaps close

### 🎯 Key Achievements
- **Contract Digitization**: Successfully replaced paper contracts with digital system
- **PDF Template**: Perfect match to original paper contract format
- **User Experience**: Intuitive Persian interface with luxury design
- **Security**: Department-based access control implemented
- **Scalability**: Modular architecture ready for additional departments

---

*This document serves as the foundation for all project planning and development activities.*

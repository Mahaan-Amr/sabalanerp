# Hiring Analysis & Team Composition Guide
## Sabalan ERP - Comprehensive Developer Hiring Strategy

**Generated:** January 2025  
**Purpose:** Optimal team composition with minimal hires while ensuring complete project coverage

---

## 📊 Project Complexity Analysis

### Project Overview
- **Type:** Enterprise Resource Planning (ERP) System
- **Industry:** Natural Stone Manufacturing & Processing
- **Architecture:** Monorepo with separate frontend/backend
- **Status:** ~70% Complete (Sales, CRM, Inventory, Security live; HR & Accounting pending)
- **Codebase Size:** Large (18,000+ lines in main contract creation page alone)
- **Complexity Level:** **HIGH** - Enterprise-grade with specialized business logic

### Key Complexity Indicators
1. **CAD Integration:** Konva.js-based stone cutting visualization system
2. **Complex Business Logic:** Stone cutting calculations, pricing, contract management
3. **Multi-workspace Architecture:** Modular workspace system with granular permissions
4. **Real-time Features:** Socket.io integration for live updates
5. **PDF Generation:** Puppeteer-based contract PDF generation with RTL support
6. **SMS Integration:** SMS.ir API for verification codes
7. **Persian/Farsi Support:** Full RTL interface with Jalali calendar
8. **Large Database Schema:** 50+ Prisma models with complex relationships

---

## 🛠️ Complete Technology Stack

### Frontend Stack
| Technology | Version | Purpose | Complexity |
|------------|---------|---------|------------|
| **Next.js** | 14.2.5 | React framework with App Router | High |
| **React** | 18.x | UI library | Medium |
| **TypeScript** | 5.x | Type safety | High |
| **Tailwind CSS** | 3.4.1 | Styling framework | Medium |
| **Konva.js** | 10.0.12 | 2D canvas for CAD visualization | **Very High** |
| **react-konva** | 18.2.14 | React wrapper for Konva | **Very High** |
| **Socket.io-client** | 4.7.5 | Real-time communication | Medium |
| **Axios** | 1.6.7 | HTTP client | Low |
| **moment-jalaali** | 0.10.4 | Persian calendar support | Medium |
| **js-cookie** | 3.0.5 | Cookie management | Low |

### Backend Stack
| Technology | Version | Purpose | Complexity |
|------------|---------|---------|------------|
| **Node.js** | 18+ | Runtime environment | Medium |
| **Express.js** | 4.19.2 | Web framework | Medium |
| **TypeScript** | 5.5.3 | Type safety | High |
| **Prisma** | 5.16.1 | ORM & database toolkit | **High** |
| **PostgreSQL** | 15 | Relational database | **High** |
| **Socket.io** | 4.7.5 | Real-time server | Medium |
| **JWT** | 9.0.2 | Authentication | Medium |
| **Puppeteer** | 22.15.0 | PDF generation | **High** |
| **Multer** | 1.4.5 | File uploads | Medium |
| **bcryptjs** | 2.4.3 | Password hashing | Low |
| **express-validator** | 7.0.1 | Input validation | Medium |
| **helmet** | 7.1.0 | Security headers | Low |
| **express-rate-limit** | 7.2.0 | Rate limiting | Low |
| **xlsx** | 0.18.5 | Excel file processing | Medium |

### DevOps & Infrastructure
| Technology | Purpose | Complexity |
|------------|---------|------------|
| **Docker** | Containerization | Medium |
| **Docker Compose** | Multi-container orchestration | Medium |
| **PostgreSQL** | Database container | Low |
| **Redis** | Caching (configured but usage unclear) | Medium |
| **Git** | Version control | Low |

### Third-Party Services
- **SMS.ir API:** SMS verification service
- **File Storage:** Local file system (contracts, uploads)

---

## 🎯 Required Skills Breakdown

### Core Skills (Must Have)

#### 1. **Full-Stack TypeScript Developer** (Primary Role)
**Required Skills:**
- ✅ **TypeScript:** Advanced proficiency (strict mode, generics, utility types)
- ✅ **React:** Expert level (hooks, context, performance optimization)
- ✅ **Next.js 14+:** App Router, Server Components, API routes
- ✅ **Node.js & Express:** RESTful API design, middleware, error handling
- ✅ **Prisma ORM:** Schema design, migrations, complex queries, relations
- ✅ **PostgreSQL:** Database design, query optimization, transactions
- ✅ **State Management:** React hooks, context API
- ✅ **API Integration:** Axios, error handling, interceptors
- ✅ **Authentication:** JWT implementation, session management
- ✅ **File Handling:** Uploads, processing, storage

**Nice to Have:**
- Socket.io experience
- PDF generation experience
- Excel file processing

**Experience Level:** **3-5 years minimum**

---

#### 2. **Frontend Specialist (CAD/Canvas)** (Critical Role)
**Required Skills:**
- ✅ **Konva.js:** Expert level - 2D canvas manipulation
- ✅ **react-konva:** React integration patterns
- ✅ **Canvas API:** Advanced understanding
- ✅ **Coordinate Systems:** Real-world to canvas conversion
- ✅ **Geometry Calculations:** Rectangle operations, measurements
- ✅ **Performance Optimization:** Large canvas rendering, object management
- ✅ **React:** Advanced hooks, performance patterns
- ✅ **TypeScript:** Type definitions for canvas objects

**Why Critical:**
The CAD system is a core differentiator. This requires specialized canvas expertise that most full-stack developers don't have.

**Experience Level:** **2-4 years with canvas libraries**

---

#### 3. **Backend/API Specialist** (Supporting Role)
**Required Skills:**
- ✅ **Express.js:** Advanced routing, middleware chains
- ✅ **Prisma:** Complex queries, transactions, migrations
- ✅ **PostgreSQL:** Query optimization, indexing, performance
- ✅ **Business Logic:** Complex calculations (stone cutting, pricing)
- ✅ **API Design:** RESTful principles, error handling
- ✅ **Authentication & Authorization:** JWT, RBAC implementation
- ✅ **File Processing:** PDF generation (Puppeteer), Excel parsing
- ✅ **Third-Party APIs:** SMS integration, external services
- ✅ **Real-time:** Socket.io server implementation

**Experience Level:** **3-5 years**

---

### Secondary Skills (Nice to Have)

#### 4. **UI/UX Developer** (Optional but Recommended)
**Required Skills:**
- ✅ **Tailwind CSS:** Advanced utility-first styling
- ✅ **RTL Support:** Right-to-left layout (Persian/Farsi)
- ✅ **Responsive Design:** Mobile-first approach
- ✅ **Design Systems:** Component library creation
- ✅ **Accessibility:** WCAG compliance
- ✅ **Glass Morphism:** Modern UI design patterns

**Experience Level:** **2-3 years**

---

#### 5. **DevOps Engineer** (Optional - Can be Part-time)
**Required Skills:**
- ✅ **Docker:** Containerization, multi-stage builds
- ✅ **Docker Compose:** Service orchestration
- ✅ **CI/CD:** GitHub Actions, GitLab CI (if needed)
- ✅ **Database Management:** PostgreSQL administration
- ✅ **Deployment:** Production deployment strategies

**Experience Level:** **2-3 years**

---

## 👥 Optimal Team Composition

### **Recommended: 2-3 Developers (Minimal but Complete)**

#### **Option 1: Two Full-Stack + One Specialist (Recommended)**
```
Team Size: 3 Developers

1. Senior Full-Stack Developer (Lead)
   - TypeScript, React, Next.js, Node.js, Express
   - Prisma, PostgreSQL
   - 4-6 years experience
   - Can handle: Backend API, frontend pages, database design
   - Salary: 80M - 120M IRR/month

2. Frontend/CAD Specialist
   - React, Konva.js, Canvas API
   - 2-4 years experience with canvas libraries
   - Can handle: CAD system, canvas visualizations, complex UI
   - Salary: 60M - 90M IRR/month

3. Mid-Level Full-Stack Developer
   - TypeScript, React, Node.js
   - 2-3 years experience
   - Can handle: Feature development, bug fixes, testing
   - Salary: 50M - 70M IRR/month
```

**Total Monthly Cost:** ~190M - 280M IRR/month

---

#### **Option 2: Two Senior Full-Stack (Budget-Conscious)**
```
Team Size: 2 Developers

1. Senior Full-Stack Developer (Lead)
   - All core technologies
   - 5-7 years experience
   - Can handle: Everything except specialized CAD work
   - Salary: 100M - 150M IRR/month

2. Full-Stack Developer with Canvas Experience
   - All core technologies + Konva.js experience
   - 3-5 years experience
   - Can handle: CAD system + general development
   - Salary: 70M - 100M IRR/month
```

**Total Monthly Cost:** ~170M - 250M IRR/month

**Risk:** Slower development, potential bottlenecks

---

#### **Option 3: One Senior + Two Mid-Level (Fastest Development)**
```
Team Size: 3 Developers

1. Senior Full-Stack Developer (Tech Lead)
   - 6+ years experience
   - Architecture decisions, code reviews
   - Salary: 120M - 180M IRR/month

2. Mid-Level Full-Stack Developer
   - 3-4 years experience
   - Feature development
   - Salary: 60M - 85M IRR/month

3. Frontend/CAD Specialist
   - 2-3 years experience
   - CAD system focus
   - Salary: 55M - 75M IRR/month
```

**Total Monthly Cost:** ~235M - 340M IRR/month

**Benefit:** Faster development, better code quality

---

## 💰 Salary Research - Iranian Market (2024-2025)

### Salary Ranges (Monthly - IRR)

#### **Full-Stack Developers**
| Experience | Salary Range (IRR/month) | Notes |
|------------|-------------------------|-------|
| **Junior (0-2 years)** | 30M - 50M | Not suitable for this project |
| **Mid-Level (2-4 years)** | 50M - 80M | Can handle feature development |
| **Senior (4-6 years)** | 80M - 120M | Ideal for lead role |
| **Expert (6+ years)** | 120M - 180M | Tech lead, architecture |

#### **Frontend Specialists**
| Experience | Salary Range (IRR/month) | Notes |
|------------|-------------------------|-------|
| **React/Next.js (2-3 years)** | 45M - 65M | Standard frontend work |
| **Canvas/Konva Specialist (2-4 years)** | 60M - 90M | Specialized skill premium |
| **Senior Frontend (4+ years)** | 80M - 120M | Complex UI/UX |

#### **Backend Specialists**
| Experience | Salary Range (IRR/month) | Notes |
|------------|-------------------------|-------|
| **Node.js/Express (2-3 years)** | 50M - 70M | Standard backend work |
| **Senior Backend (4+ years)** | 80M - 120M | Complex business logic |
| **Database Specialist** | 70M - 100M | Prisma + PostgreSQL expert |

### **Market Data Sources**
Based on research from:
- **Glassdoor Iran:** Average software developer: ~110M IRR/year (9M/month) - **Outdated/Inaccurate**
- **SpotSalary:** Full-stack range: 20M-200M IRR/year - **Outdated**
- **Local Market Reality (2024-2025):** 
  - Entry-level: 30M-50M/month
  - Mid-level: 50M-80M/month
  - Senior: 80M-150M/month
  - Expert: 150M-250M/month

**Note:** Iranian job sites (Jobinja, Job Vision, E Estekhdam) don't always publish accurate salary data. Market rates are typically negotiated and vary significantly based on:
- Company size and funding
- Remote vs. on-site
- Project complexity
- Developer's portfolio and negotiation skills

---

## 🎯 Hiring Recommendations

### **Best Combination: Option 1 (3 Developers)**

**Rationale:**
1. **Coverage:** All critical skills covered
2. **Efficiency:** Specialized CAD developer prevents bottlenecks
3. **Quality:** Senior lead ensures architecture and code quality
4. **Scalability:** Can handle remaining 30% + future features
5. **Risk Mitigation:** Not dependent on single developer

### **Team Structure:**

```
┌─────────────────────────────────────────┐
│   Senior Full-Stack Developer (Lead)   │
│   - Architecture & Code Reviews        │
│   - Backend API Development            │
│   - Database Design & Optimization     │
│   - Complex Business Logic             │
└─────────────────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼──────┐    ┌───────▼──────┐
│ Frontend │    │ Mid-Level    │
│ CAD      │    │ Full-Stack   │
│ Specialist│    │ Developer    │
│          │    │              │
│ - Konva  │    │ - Features   │
│ - Canvas │    │ - Bug Fixes  │
│ - CAD UI │    │ - Testing    │
└──────────┘    └──────────────┘
```

### **Key Hiring Criteria:**

#### **Senior Full-Stack Developer (Lead)**
**Must Have:**
- ✅ 4+ years TypeScript/React/Node.js
- ✅ Prisma + PostgreSQL experience (complex queries)
- ✅ Next.js 14+ App Router experience
- ✅ Portfolio showing enterprise applications
- ✅ Experience with authentication/authorization systems
- ✅ Code review and mentoring experience

**Interview Focus:**
- Database schema design
- API architecture decisions
- Performance optimization
- Security best practices

---

#### **Frontend/CAD Specialist**
**Must Have:**
- ✅ 2+ years Konva.js or similar canvas library
- ✅ React + TypeScript proficiency
- ✅ Portfolio with canvas/visualization projects
- ✅ Understanding of coordinate systems
- ✅ Performance optimization for canvas

**Interview Focus:**
- Canvas manipulation code samples
- Coordinate transformation problems
- Performance optimization strategies
- React-Konva integration patterns

---

#### **Mid-Level Full-Stack Developer**
**Must Have:**
- ✅ 2-3 years TypeScript/React/Node.js
- ✅ Prisma basic experience
- ✅ Next.js experience
- ✅ Ability to work independently on features

**Interview Focus:**
- Feature implementation approach
- Code quality and testing
- Problem-solving skills

---

## 📋 Job Posting Templates

### **Senior Full-Stack Developer**

**Title:** Senior Full-Stack TypeScript Developer - ERP System

**Requirements:**
- 4+ years experience with TypeScript, React, Next.js, Node.js
- Strong Prisma ORM and PostgreSQL experience
- Experience building enterprise applications
- RESTful API design and implementation
- Authentication/authorization systems (JWT, RBAC)
- Code review and team leadership experience
- Persian/Farsi language proficiency (for RTL support)

**Nice to Have:**
- Socket.io experience
- PDF generation (Puppeteer)
- Excel file processing
- Docker experience

**Salary:** 80M - 120M IRR/month (negotiable based on experience)

---

### **Frontend/CAD Specialist**

**Title:** Frontend Developer - Canvas/CAD Specialist

**Requirements:**
- 2+ years experience with Konva.js or similar canvas libraries
- Strong React + TypeScript skills
- Experience with 2D canvas manipulation
- Understanding of coordinate systems and transformations
- Portfolio demonstrating canvas/visualization projects
- Performance optimization for canvas rendering

**Nice to Have:**
- react-konva experience
- Geometry/math calculations
- CAD or design tool experience

**Salary:** 60M - 90M IRR/month (negotiable based on experience)

---

### **Mid-Level Full-Stack Developer**

**Title:** Mid-Level Full-Stack Developer - ERP System

**Requirements:**
- 2-3 years TypeScript, React, Next.js, Node.js
- Prisma ORM experience
- RESTful API development
- Ability to work independently
- Good problem-solving skills

**Salary:** 50M - 70M IRR/month

---

## ⚠️ Important Considerations

### **Red Flags to Avoid:**
1. ❌ Developers without TypeScript experience (project is 100% TypeScript)
2. ❌ Developers without Prisma experience (critical for database work)
3. ❌ Developers who haven't worked with canvas libraries (for CAD role)
4. ❌ Developers without portfolio or GitHub (can't verify skills)
5. ❌ Developers unwilling to do code reviews or pair programming

### **Green Flags:**
1. ✅ Active GitHub profile with relevant projects
2. ✅ Experience with similar ERP or enterprise systems
3. ✅ Strong communication skills (Persian/Farsi)
4. ✅ Willingness to learn and adapt
5. ✅ Experience with complex business logic

### **Contract Considerations:**
- **Trial Period:** 1-2 months probation
- **Remote vs. On-site:** Consider remote for better talent pool
- **Equity/Stock Options:** Consider for long-term retention
- **Learning Budget:** Allocate for courses/conferences
- **Code Reviews:** Mandatory for all PRs
- **Documentation:** Require code documentation

---

## 📈 Project Timeline with Team

### **Remaining Work (30%):**
- HR Workspace: ~3-4 months
- Accounting Workspace: ~4-5 months
- Enhancements & Bug Fixes: Ongoing
- CAD System Improvements: Ongoing

### **With 3-Developer Team:**
- **Estimated Completion:** 6-8 months for core features
- **With 2-Developer Team:** 8-12 months (slower, higher risk)

---

## 🎓 Training & Onboarding Plan

### **Week 1-2: Onboarding**
- Codebase walkthrough
- Architecture overview
- Development environment setup
- Code style and conventions
- Git workflow

### **Week 3-4: First Tasks**
- Small bug fixes
- Simple feature additions
- Code review participation
- Pair programming sessions

### **Ongoing:**
- Weekly team meetings
- Code reviews
- Knowledge sharing sessions
- Documentation updates

---

## 📞 Next Steps

1. **Post Jobs:** Use templates above on Jobinja, Job Vision, E Estekhdam
2. **Screen Candidates:** GitHub review, portfolio check
3. **Technical Interview:** Code challenge + architecture discussion
4. **Trial Period:** 1-2 months with clear milestones
5. **Team Integration:** Onboarding plan execution

---

## 📚 Additional Resources

- **Project Documentation:** `/docs` folder
- **API Documentation:** `/docs/API_DOCUMENTATION.md`
- **Database Schema:** `/backend/prisma/schema.prisma`
- **Business Requirements:** `/docs/BUSINESS_REQUIREMENTS.md`

---

**Last Updated:** January 2025  
**Document Version:** 1.0


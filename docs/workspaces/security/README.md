# Security and Enforcement Workspace - Soblan ERP

## 🎯 Overview

The Security and Enforcement Workspace manages all security operations in Soblan Stone, including access control, attendance tracking, security personnel management, and enforcement activities. It provides comprehensive security management with real-time monitoring and enforcement capabilities.

## 🏗️ Current Status

- **Progress**: 100% Complete ✅
- **Priority**: Low (Core Complete)
- **Foundation**: Fully implemented security system
- **Integration**: Complete workspace integration with HR workspace for employee data

## 📋 Core Features

### ✅ Completed Features

#### Shift Management
- **Day/Night Shifts**: 12-hour shift system (7AM-7PM, 7PM-7AM)
- **Shift Configuration**: Flexible shift scheduling
- **Shift Assignment**: Security personnel shift assignments
- **Shift Tracking**: Real-time shift monitoring

#### Digital Attendance System
- **Check-in/Check-out**: Digital attendance tracking
- **Attendance Records**: Comprehensive attendance history
- **Exception Handling**: Mission assignments, leave requests
- **Digital Signatures**: Electronic signature capture
- **Persian Calendar**: Jalali calendar integration

#### Security Personnel Management
- **Role Assignment**: Security role management
- **Permission Control**: Role-based access control
- **Personnel Tracking**: Security staff monitoring
- **Performance Tracking**: Security personnel performance

#### Exception Management
- **Mission Assignments**: Complete mission tracking
- **Leave Management**: Hourly leave requests
- **Absence Reporting**: Enhanced absence management
- **Approval Workflow**: Multi-level approval system

#### Mobile Optimization
- **Mobile Dashboard**: Touch-friendly interface
- **Offline Capability**: Offline check-in/check-out
- **PWA Support**: Progressive Web App features
- **Real-time Sync**: Online/offline synchronization

### ✅ Recently Completed Features
- **Workspace Integration**: Complete migration to workspace-based architecture
- **Security Workspace Pages**: Individual pages for attendance, shifts, personnel, exceptions, reports
- **Workspace Middleware**: Security API routes now use workspace access control
- **Security Dashboard**: Integrated with workspace system and navigation
- **Enhanced Reporting**: Advanced security reports
- **Integration Hub**: Cross-workspace data sharing

### 📋 Planned Features
- **Advanced Security Analytics**: Security performance metrics
- **Incident Management**: Security incident tracking
- **Access Control**: Advanced access management
- **Security Compliance**: Compliance monitoring and reporting

## 🎨 User Interface

### Main Dashboard
- **Security Overview**: Current shift status, active personnel
- **Attendance Summary**: Today's attendance statistics
- **Recent Activities**: Latest security activities
- **Quick Actions**: Check-in/out, create exception, view reports

### Navigation Sidebar
- **Dashboard**: Security overview and analytics
- **Attendance**: Digital attendance management
- **Personnel**: Security personnel management
- **Shifts**: Shift management and scheduling
- **Exceptions**: Exception requests and approvals
- **Missions**: Mission assignments and tracking
- **Reports**: Security reports and analytics
- **Settings**: Workspace-specific settings

### Workspace Theme
- **Primary Color**: Red (#ef4444)
- **Secondary Color**: Rose (#f43f5e)
- **Accent Color**: Pink (#ec4899)
- **Design**: Glass morphism with security-focused elements

## 🔗 Integration Points

### HR Workspace
- **Employee Data**: Employee information for security
- **Department Access**: Department-based access control
- **Performance Integration**: Security performance metrics
- **Leave Integration**: HR leave system integration

### Sales Workspace
- **Customer Visits**: Customer visit tracking
- **Client Access**: Customer access to facilities
- **Security Notes**: Customer-related security information
- **Visit Scheduling**: Customer visit coordination

### Inventory Workspace
- **Warehouse Security**: Warehouse access control
- **Equipment Security**: Equipment access monitoring
- **Asset Protection**: Inventory security measures
- **Access Logs**: Warehouse access tracking

### Accounting Workspace
- **Security Costs**: Security department expenses
- **Equipment Costs**: Security equipment purchases
- **Maintenance Costs**: Security system maintenance
- **Compliance Costs**: Security compliance expenses

## 📊 Data Models

### Core Entities
```typescript
// Shift
interface Shift {
  id: string;
  name: string;
  namePersian: string;
  startTime: string; // "07:00" | "19:00"
  endTime: string; // "19:00" | "07:00"
  duration: number; // 12 hours
  isActive: boolean;
  securityPersonnel: SecurityPersonnel[];
  attendanceRecords: AttendanceRecord[];
  createdAt: Date;
  updatedAt: Date;
}

// Security Personnel
interface SecurityPersonnel {
  id: string;
  userId: string;
  shiftId: string;
  position: string; // "سرپرست امنیت" | "نگهبان"
  isActive: boolean;
  user: User;
  shift: Shift;
  attendanceRecords: AttendanceRecord[];
  createdAt: Date;
  updatedAt: Date;
}

// Attendance Record
interface AttendanceRecord {
  id: string;
  employeeId: string;
  securityPersonnelId: string;
  date: Date; // Persian calendar date
  shiftId: string;
  entryTime: string; // "06:45"
  exitTime: string; // "18:22"
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'MISSION' | 'HOURLY_LEAVE' | 'SICK_LEAVE' | 'VACATION';
  exceptionType: string; // "ماموریت" | "مرخصی ساعتی"
  exceptionTime: string; // "16:10" for missions
  exceptionDuration: number; // Hours for leave
  digitalSignature: string; // Base64 signature data
  notes: string;
  employee: User;
  securityPersonnel: SecurityPersonnel;
  shift: Shift;
  createdAt: Date;
  updatedAt: Date;
}

// Exception Request
interface ExceptionRequest {
  id: string;
  employeeId: string;
  exceptionType: 'MISSION' | 'HOURLY_LEAVE' | 'SICK_LEAVE' | 'VACATION' | 'ABSENCE' | 'EMERGENCY_LEAVE' | 'PERSONAL_LEAVE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  startDate: Date;
  endDate: Date;
  startTime: string; // "14:30" for hourly leave
  endTime: string; // "16:30" for hourly leave
  duration: number; // Hours for leave
  reason: string;
  description: string;
  emergencyContact: string;
  medicalCertificate: string; // For sick leave
  approvedBy: string;
  rejectedBy: string;
  approvedAt: Date;
  rejectedAt: Date;
  rejectionReason: string;
  employee: User;
  approver: User;
  rejecter: User;
  createdAt: Date;
  updatedAt: Date;
}

// Mission Assignment
interface MissionAssignment {
  id: string;
  employeeId: string;
  assignedBy: string; // Security personnel who assigned
  missionType: string; // "ماموریت داخلی" | "ماموریت خارجی"
  missionLocation: string;
  missionPurpose: string;
  startDate: Date;
  endDate: Date;
  startTime: string; // "09:00"
  endTime: string; // "17:00"
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approvedBy: string; // Manager who approved
  approvedAt: Date;
  notes: string;
  employee: User;
  assigner: User;
  approver: User;
  createdAt: Date;
  updatedAt: Date;
}
```

## 🚀 Implementation Roadmap

### Phase 1: Workspace Integration (Week 1)
- [ ] Create Security workspace structure
- [ ] Migrate existing security system
- [ ] Implement workspace-specific routing
- [ ] Create Security workspace dashboard
- [ ] Implement collapsible sidebar navigation

### Phase 2: Enhanced Features (Week 2)
- [ ] Implement advanced security analytics
- [ ] Add incident management system
- [ ] Create security compliance reporting
- [ ] Implement advanced access control
- [ ] Add security performance metrics

### Phase 3: Integration (Week 3)
- [ ] Integrate with HR workspace
- [ ] Integrate with Sales workspace
- [ ] Integrate with Inventory workspace
- [ ] Implement cross-workspace notifications
- [ ] Test integration workflows

### Phase 4: Optimization (Week 4)
- [ ] Optimize performance
- [ ] Add advanced reporting
- [ ] Implement workspace-specific themes
- [ ] Add mobile enhancements
- [ ] Final testing and deployment

## 🔐 Permissions

### Security Manager
- Full access to all security features
- Can manage security personnel
- Access to all security reports
- Can approve security exceptions

### Security Supervisor
- Access to security operations
- Can manage attendance records
- Can approve mission assignments
- Limited security report access

### Security Personnel
- Access to attendance system
- Can create exception requests
- Can view own records
- Limited system access

### Vehicle Gate Operations
- **Security Manager / Supervisor**: can create, edit, activate/deactivate driver+vehicle registry pairs; void inbound/outbound movement records; and write supervisor shift reports.
- **Security Personnel**: can record inbound loaded-vehicle entries, complete inbound information, record outbound gate exit time, add categorized movement attachments, and view active registry pairs.
- **Logistics**: can view/select only active security-owned driver+vehicle pairs during بارگیری; logistics cannot create, edit, delete, or deactivate the registry.
- **Boundary**: حراست approves driver/vehicle eligibility and physical gate movement. لجستیک remains responsible for بارگیری rows, quantities, and remaining shipment calculations.
- **Registry completeness**: new pairs require driver identity/contact details, vehicle details, home and relative contact information, and at least one license, vehicle-card, and driver photo. Existing incomplete pairs have a 30-day completion grace period.

### Viewer
- Read-only access to security data
- View security reports
- No modification permissions

## 📈 Success Metrics

### Business Metrics
- **Attendance Accuracy**: > 99%
- **Exception Processing**: < 2 hours
- **Security Response Time**: < 5 minutes
- **Compliance Rate**: > 95%

### Technical Metrics
- **Check-in Speed**: < 3 seconds
- **Report Generation**: < 5 seconds
- **System Uptime**: > 99.9%
- **Data Integrity**: > 99.9%

## 🔄 Future Enhancements

### Advanced Features
- **AI-Powered Security Analytics**: Predictive security insights
- **Biometric Integration**: Fingerprint and facial recognition
- **IoT Security Sensors**: Smart security monitoring
- **Advanced Incident Management**: Automated incident response
- **Security Compliance**: Automated compliance monitoring

### Integration Expansions
- **Access Control Systems**: Physical access control integration
- **Surveillance Systems**: CCTV and monitoring integration
- **Emergency Response**: Emergency notification systems
- **Visitor Management**: Visitor tracking and management
- **Security Training**: Integrated security training platform

---

**Last Updated**: September 21, 2025  
**Next Review**: September 28, 2025  
**Owner**: Security Development Team

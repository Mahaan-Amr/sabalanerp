# Admin User Management System

## 📋 Overview

The Admin User Management System provides comprehensive user and department management capabilities for administrators and managers. This system allows for complete control over user creation, role assignment, workspace permissions, feature-level permissions, and department management. The system is fully implemented and operational.

## 🎯 Features

### ✅ User Management
- **User Creation**: Create new users with complete profile information
- **User Listing**: View all users with advanced filtering and search
- **User Editing**: Update user information and settings
- **User Deletion**: Remove users with safety checks
- **Role Assignment**: Assign ADMIN, USER, or MODERATOR roles
- **Department Assignment**: Assign users to specific departments

### ✅ Workspace Permissions
- **Granular Access Control**: Set view, edit, or admin permissions per workspace
- **Workspace-Specific Access**: Control access to Sales, CRM, HR, Accounting, Inventory, and Security workspaces
- **Permission Management**: Easy permission assignment and modification
- **Real-time Updates**: Immediate permission changes take effect

### ✅ Department Management
- **Department Creation**: Create new organizational departments
- **Department Listing**: View all departments with user counts
- **Department Editing**: Update department information
- **Department Deletion**: Remove departments with safety checks
- **User Assignment**: Assign users to departments

## 🏗️ Architecture

### Frontend Components

#### User Management Pages
```
/dashboard/users/
├── page.tsx                    # Main user listing with filters
├── create/
│   └── page.tsx               # User creation form
├── [id]/
│   ├── page.tsx               # User details view
│   ├── edit/
│   │   └── page.tsx           # User editing form
│   └── permissions/
│       └── page.tsx           # Workspace permissions management
```

#### Department Management Pages
```
/dashboard/departments/
├── page.tsx                    # Department listing
├── create/
│   └── page.tsx               # Department creation form
└── [id]/
    ├── page.tsx               # Department details
    └── edit/
        └── page.tsx           # Department editing form
```

### Backend API Endpoints

#### User Management
- `GET /api/users` - List all users (Admin only)
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user information
- `DELETE /api/users/:id` - Delete user (Admin only)

#### Workspace Permissions
- `GET /api/workspace-permissions` - List all permissions (Admin only)
- `POST /api/workspace-permissions` - Grant workspace permission
- `PUT /api/workspace-permissions/:id` - Update permission
- `DELETE /api/workspace-permissions/:id` - Revoke permission

#### Department Management
- `GET /api/departments` - List all departments
- `GET /api/departments/:id` - Get department details
- `POST /api/departments` - Create department (Admin only)
- `PUT /api/departments/:id` - Update department (Admin only)
- `DELETE /api/departments/:id` - Delete department (Admin only)

## 🔐 Security & Access Control

### Role-Based Access Control (RBAC)
- **ADMIN**: Full access to all user management features
- **MODERATOR**: Limited access to user management
- **USER**: No access to user management features

### Workspace Permissions
- **VIEW**: Read-only access to workspace
- **EDIT**: Full access to workspace features
- **ADMIN**: Administrative access to workspace

### Security Features
- **Authentication Required**: All endpoints require valid JWT token
- **Role Validation**: Server-side role checking
- **Input Validation**: Comprehensive form validation
- **Error Handling**: Secure error messages
- **Audit Trail**: Permission changes are logged

## 🎨 User Interface

### Design System
- **Glass Morphism**: Consistent with overall application design
- **Persian/Farsi Support**: Full RTL support and Persian text
- **Dark/Light Mode**: Automatic theme adaptation
- **Responsive Design**: Mobile-friendly interface

### Key UI Components
- **User Cards**: Clean user information display
- **Permission Matrix**: Visual workspace permission management
- **Filter System**: Advanced search and filtering
- **Confirmation Modals**: Safe deletion confirmations
- **Status Indicators**: Visual role and status indicators

## 📊 Features in Detail

### User Creation Form
- **Basic Information**: First name, last name, email, username
- **Security**: Password with confirmation and strength validation
- **Role Assignment**: Dropdown selection for user roles
- **Department Assignment**: Optional department selection
- **Workspace Permissions**: Visual permission matrix
- **Status Control**: Active/inactive user toggle

### User Listing & Management
- **Advanced Filtering**: Search by name, email, username
- **Department Filter**: Filter by department
- **Role Filter**: Filter by user role
- **Status Filter**: Filter by active/inactive status
- **Pagination**: Efficient large dataset handling
- **Bulk Operations**: Future-ready for bulk actions

### Permission Management
- **Visual Matrix**: Easy-to-understand permission grid
- **Real-time Updates**: Immediate permission changes
- **Permission Levels**: Clear view/edit/admin distinctions
- **Workspace Coverage**: All 6 workspaces supported
- **Audit Information**: Shows who granted permissions and when

### Department Management
- **Bilingual Support**: English and Persian names
- **User Counts**: Shows number of users per department
- **Safety Checks**: Prevents deletion of departments with users
- **Hierarchical Structure**: Ready for future organizational hierarchy

## 🔧 Technical Implementation

### Frontend Technologies
- **Next.js 14+**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **React Icons**: Consistent iconography
- **Axios**: HTTP client with interceptors

### Backend Technologies
- **Express.js**: RESTful API server
- **Prisma**: Database ORM
- **PostgreSQL**: Primary database
- **JWT**: Authentication tokens
- **bcrypt**: Password hashing

### Database Schema
```sql
-- Users table with workspace permissions
User {
  id: String (Primary Key)
  email: String (Unique)
  username: String (Unique)
  firstName: String
  lastName: String
  role: UserRole (ADMIN, USER, MODERATOR)
  departmentId: String (Foreign Key)
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
}

-- Workspace permissions
WorkspacePermission {
  id: String (Primary Key)
  userId: String (Foreign Key)
  workspace: String (sales, crm, hr, accounting, inventory, security)
  permissionLevel: String (view, edit, admin)
  grantedBy: String (Foreign Key)
  grantedAt: DateTime
  expiresAt: DateTime (Optional)
  isActive: Boolean
}

-- Departments
Department {
  id: String (Primary Key)
  name: String
  namePersian: String
  description: String
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
}
```

## 🚀 Usage Guide

### For Administrators

#### Creating a New User
1. Navigate to `/dashboard/users`
2. Click "کاربر جدید" (New User)
3. Fill in basic information (name, email, username, password)
4. Select appropriate role (USER, MODERATOR, ADMIN)
5. Choose department (optional)
6. Set workspace permissions using the permission matrix
7. Click "ایجاد کاربر" (Create User)

#### Managing User Permissions
1. Go to user list at `/dashboard/users`
2. Click the permissions icon (⚙️) for the desired user
3. Use the permission matrix to set access levels
4. Click "ذخیره تغییرات" (Save Changes)

#### Managing Departments
1. Navigate to `/dashboard/departments`
2. Click "بخش جدید" (New Department) to create
3. Fill in department name (English and Persian)
4. Add description
5. Set active status
6. Click "ایجاد بخش" (Create Department)

### For Managers

#### Assigning Workspace Access
1. Access user permissions page
2. Select appropriate workspace permissions
3. Choose permission level (view, edit, admin)
4. Save changes

#### Department Management
1. Create departments for organizational structure
2. Assign users to appropriate departments
3. Monitor department user counts

## 🔍 Monitoring & Analytics

### User Statistics
- Total user count
- Active vs inactive users
- Role distribution
- Department distribution

### Permission Analytics
- Workspace access distribution
- Permission level usage
- Recent permission changes

### Department Metrics
- Department user counts
- Department activity levels
- Organizational structure overview

## 🛡️ Security Considerations

### Data Protection
- Password hashing with bcrypt
- JWT token expiration
- Input sanitization
- SQL injection prevention

### Access Control
- Role-based permissions
- Workspace-level access control
- Admin-only operations
- Audit logging

### Best Practices
- Regular permission reviews
- Principle of least privilege
- Secure password policies
- Regular security updates

## 🔮 Future Enhancements

### Planned Features
- **Bulk User Operations**: Import/export users
- **Advanced Permissions**: Feature-level permissions
- **User Groups**: Group-based permission management
- **Audit Logs**: Detailed permission change history
- **Two-Factor Authentication**: Enhanced security
- **User Self-Service**: Password reset and profile updates

### Integration Opportunities
- **LDAP/Active Directory**: Enterprise user management
- **SSO Integration**: Single sign-on support
- **API Access**: Programmatic user management
- **Webhook Support**: Real-time notifications

## 📝 Conclusion

The Admin User Management System provides a comprehensive, secure, and user-friendly solution for managing users, permissions, and departments within the Soblan ERP system. With its glass morphism design, Persian language support, and robust security features, it offers administrators complete control over system access while maintaining an excellent user experience.

The system is designed to scale with the organization's growth and can be easily extended with additional features as needed. Its modular architecture ensures maintainability and allows for future enhancements without disrupting existing functionality.

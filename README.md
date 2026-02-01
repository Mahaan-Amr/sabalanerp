# Sabalan ERP

A comprehensive Enterprise Resource Planning system built with modern technologies.

## Tech Stack

### Frontend
- **Framework**: Next.js 14+ (React-based)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Custom components with React Icons
- **State Management**: React hooks (useState, useEffect, useContext)
- **Real-time Communication**: Socket.io client
- **Build Tool**: Next.js built-in bundler

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

## Project Structure

```
sabalanerp/
├── frontend/                 # Next.js frontend application
│   ├── src/
│   │   ├── app/             # Next.js 13+ app directory
│   │   ├── components/      # Reusable React components
│   │   ├── contexts/        # React contexts (Auth, etc.)
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # Utility libraries and API client
│   │   └── types/           # TypeScript type definitions
│   ├── public/              # Static assets
│   └── package.json
├── backend/                  # Express.js backend API
│   ├── src/
│   │   ├── routes/          # API route handlers
│   │   ├── middleware/      # Express middleware
│   │   ├── prisma/          # Database schema and migrations
│   │   └── index.ts         # Server entry point
│   └── package.json
├── docker-compose.yml        # Docker services (PostgreSQL, Redis)
└── package.json             # Root package.json with scripts
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- Docker and Docker Compose
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd sabalanerp
   ```

2. **Install dependencies**
   ```bash
   npm run install:all
   ```

3. **Set up environment variables**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Edit `backend/.env` with your configuration:
   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sabalanerp?schema=public"
   JWT_SECRET="your-super-secret-jwt-key-here"
   JWT_EXPIRES_IN="7d"
   PORT=5000
   NODE_ENV="development"
   FRONTEND_URL="http://localhost:3000"
   ```

4. **Start Docker services**
   ```bash
   npm run docker:up
   ```

5. **Set up the database**
   ```bash
   npm run db:migrate
   npm run db:generate
   ```

6. **Start the development servers**
   ```bash
   npm run dev
   ```

This will start:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## Available Scripts

### Root Level
- `npm run dev` - Start both frontend and backend in development mode
- `npm run build` - Build both frontend and backend for production
- `npm run start` - Start both frontend and backend in production mode
- `npm run install:all` - Install dependencies for all packages
- `npm run docker:up` - Start Docker services
- `npm run docker:down` - Stop Docker services

### Database
- `npm run db:migrate` - Run database migrations
- `npm run db:generate` - Generate Prisma client
- `npm run db:studio` - Open Prisma Studio

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users` - Get all users (Admin only)
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (Admin only)

### Posts
- `GET /api/posts` - Get all posts
- `GET /api/posts/:id` - Get post by ID
- `POST /api/posts` - Create post (Authenticated)
- `PUT /api/posts/:id` - Update post (Author only)
- `DELETE /api/posts/:id` - Delete post (Author only)

### Orders
- `GET /api/orders` - Get orders (User's own or all for Admin)
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order (Authenticated)
- `PUT /api/orders/:id/status` - Update order status (Admin only)
- `DELETE /api/orders/:id` - Delete order (Admin only)

## Features

- **User Management**: Registration, authentication, and user profiles
- **Role-based Access Control**: Admin, User, and Moderator roles
- **Real-time Communication**: Socket.io integration for live updates
- **Order Management**: Complete order lifecycle management
- **Content Management**: Posts and comments system
- **Responsive Design**: Mobile-first design with Tailwind CSS
- **Type Safety**: Full TypeScript implementation
- **Database Migrations**: Automated with Prisma
- **Docker Support**: Easy development environment setup

## Development

### Adding New Features

1. **Backend**: Add routes in `backend/src/routes/`
2. **Frontend**: Add components in `frontend/src/components/`
3. **Database**: Update schema in `backend/prisma/schema.prisma`
4. **API Client**: Update `frontend/src/lib/api.ts`

### Database Schema Updates

1. Modify `backend/prisma/schema.prisma`
2. Run `npm run db:migrate` to create migration
3. Run `npm run db:generate` to update Prisma client

## Production Deployment

1. Build the application: `npm run build`
2. Set production environment variables
3. Start the application: `npm run start`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { parseCookies, resolveAuthoritativeSession, SESSION_COOKIE } from '../services/identitySessionService';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
    role: string;
    departmentId: string | null;
    isActive: boolean;
    mustChangePassword: boolean;
  };
  sessionId?: string;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
    return;
  }

  try {
    const session = await resolveAuthoritativeSession(prisma, token);
    const user = session?.user;

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        error: 'User not found or inactive'
      });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      departmentId: user.departmentId,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword
    };
    req.sessionId = session!.id;
    const allowedDuringPasswordChange = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];
    if (user.mustChangePassword && !allowedDuringPasswordChange.some((path) => req.originalUrl.startsWith(path))) {
      res.status(403).json({ success: false, error: 'PASSWORD_CHANGE_REQUIRED', mustChangePassword: true });
      return;
    }
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
    return;
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `User role ${req.user.role} is not authorized to access this route`
      });
      return;
    }

    next();
  };
};

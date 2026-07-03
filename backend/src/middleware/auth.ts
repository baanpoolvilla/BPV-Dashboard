import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; role: string };
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireCEO(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== 'CEO') {
    res.status(403).json({ error: 'CEO access only' });
    return;
  }
  next();
}

export function requireSelfOrCEO(req: AuthRequest, res: Response, next: NextFunction): void {
  const targetUserId = req.params['userId'];
  if (req.userRole !== 'CEO' && req.userId !== targetUserId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

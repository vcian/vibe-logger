import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

export interface AuthUser {
  username: string;
  role: string;
}

export interface AuthConfig {
  enabled: boolean;
  jwtSecret: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

function isApiRequest(req: Request): boolean {
  return req.path.startsWith('/logs') || req.originalUrl.includes('/logs/');
}

function buildLoginPath(req: Request): string {
  return req.baseUrl ? `${req.baseUrl}/login` : '/login';
}

function rejectUnauthorized(req: Request, res: Response): void {
  if (isApiRequest(req)) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }
  res.redirect(buildLoginPath(req));
}

export function createAuthMiddleware(config: AuthConfig) {
  return function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void {
    if (!config.enabled) {
      next();
      return;
    }

    const token: string | undefined = req.cookies?.lgr_session as string | undefined;
    if (!token) {
      rejectUnauthorized(req, res);
      return;
    }

    try {
      const payload: JwtPayload = jwt.verify(token, config.jwtSecret) as JwtPayload;
      req.user = {
        username: String(payload.username ?? ''),
        role: String(payload.role ?? 'viewer'),
      };
      next();
    } catch (_error) {
      rejectUnauthorized(req, res);
    }
  };
}

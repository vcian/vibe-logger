import express, { Request, Response, Router } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { createAuthRoutes, AuthRouteUser } from './auth/authRoutes';
import { createAuthMiddleware, AuthenticatedRequest } from './auth/authMiddleware';
import { createLogRoutes } from './routes/logRoutes';
import { LogStore } from './store/logStore';

export interface MiddlewareConfig {
  mountPath: string;
  authEnabled: boolean;
  jwtSecret: string;
  sessionTtl: number;
  maxAttempts: number;
  lockoutMins: number;
  users: AuthRouteUser[];
}

function resolveUiDir(): string {
  const distUi: string = path.resolve(__dirname, 'ui');
  if (fs.existsSync(distUi)) {
    return distUi;
  }
  return path.resolve(process.cwd(), 'src/ui');
}

export function createLoggerUIMiddleware(config: MiddlewareConfig, store: LogStore): Router {
  const router: Router = Router();
  const uiDir: string = resolveUiDir();
  const authMiddleware = createAuthMiddleware({
    enabled: config.authEnabled,
    jwtSecret: config.jwtSecret,
  });

  router.use(cookieParser());
  router.use(express.json({ limit: '1mb' }));
  router.use(
    createAuthRoutes({
      enabled: config.authEnabled,
      users: config.users,
      jwtSecret: config.jwtSecret,
      sessionTtlSeconds: config.sessionTtl,
      maxAttempts: config.maxAttempts,
      lockoutMins: config.lockoutMins,
    })
  );

  router.get('/login', (_req: Request, res: Response): void => {
    res.sendFile(path.join(uiDir, 'login.html'));
  });

  router.get('/dashboard.css', (_req: Request, res: Response): void => {
    res.sendFile(path.join(uiDir, 'dashboard.css'));
  });
  router.get('/login.css', (_req: Request, res: Response): void => {
    res.sendFile(path.join(uiDir, 'login.css'));
  });
  router.get('/dashboard.js', (_req: Request, res: Response): void => {
    res.sendFile(path.join(uiDir, 'dashboard.js'));
  });

  router.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
    if (!config.authEnabled) {
      res.sendFile(path.join(uiDir, 'dashboard.html'));
      return;
    }
    if (!req.user) {
      const loginPath: string = req.baseUrl ? `${req.baseUrl}/login` : '/login';
      res.redirect(loginPath);
      return;
    }
    res.sendFile(path.join(uiDir, 'dashboard.html'));
  });

  router.use('/logs', authMiddleware, createLogRoutes(store));

  const appRouter: Router = Router();
  appRouter.use(config.mountPath, router);
  return appRouter;
}

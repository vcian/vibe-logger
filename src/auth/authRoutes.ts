import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

export interface AuthRouteUser {
  username: string;
  passwordHash: string;
  role: string;
}

export interface AuthRoutesConfig {
  enabled: boolean;
  users: AuthRouteUser[];
  jwtSecret: string;
  sessionTtlSeconds: number;
  maxAttempts: number;
  lockoutMins: number;
}

export function createAuthRoutes(config: AuthRoutesConfig): Router {
  const router: Router = Router();
  const loginLimiter = rateLimit({
    windowMs: config.lockoutMins * 60 * 1000,
    limit: config.maxAttempts,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: "Too many login attempts" }
  });

  router.post("/auth/login", loginLimiter, async (req: Request, res: Response): Promise<void> => {
    if (!config.enabled) {
      res.json({ ok: true, username: "anonymous", role: "admin" });
      return;
    }

    const username: string = String(req.body?.username ?? "");
    const password: string = String(req.body?.password ?? "");
    if (!username || !password) {
      res.status(400).json({ ok: false, message: "Username and password are required" });
      return;
    }
    const user: AuthRouteUser | undefined = config.users.find((candidate: AuthRouteUser): boolean => {
      return candidate.username === username;
    });

    if (!user) {
      res.status(401).json({ ok: false, message: "Invalid credentials" });
      return;
    }

    const isValid: boolean = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ ok: false, message: "Invalid credentials" });
      return;
    }

    const token: string = jwt.sign(
      { username: user.username, role: user.role },
      config.jwtSecret,
      { algorithm: "HS256", expiresIn: config.sessionTtlSeconds }
    );

    res.cookie("lgr_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: config.sessionTtlSeconds * 1000
    });
    res.status(200).json({ ok: true, username: user.username, role: user.role });
  });

  router.post("/auth/logout", (_req: Request, res: Response): void => {
    res.clearCookie("lgr_session");
    res.json({ ok: true });
  });

  return router;
}

import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import readline from "readline";
import { createAuthRoutes } from "../src/auth/authRoutes";
import { createAuthMiddleware } from "../src/auth/authMiddleware";
import { runHashPasswordCli } from "../src/auth/hashPassword";
import { createLoggerUIMiddleware } from "../src/middleware";
import { createInMemoryLogStore } from "../src/store/logStore";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  while (servers.length) {
    const server = servers.pop();
    server?.close();
  }
});

async function startApp(app: express.Express): Promise<string> {
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("Authentication", () => {
  describe("POST /auth/login", () => {
    it("returns 200 and sets cookie on valid credentials", async () => {
    const hash = await bcrypt.hash("secret", 10);
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRoutes({
      enabled: true,
      users: [{ username: "admin", passwordHash: hash, role: "admin" }],
      jwtSecret: "test-secret",
      sessionTtlSeconds: 3600,
      maxAttempts: 5,
      lockoutMins: 15
    }));
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret" })
    });
    expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("lgr_session=");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
  });

    it("returns 401 on wrong password", async () => {
    const hash = await bcrypt.hash("secret", 10);
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRoutes({
      enabled: true,
      users: [{ username: "admin", passwordHash: hash, role: "admin" }],
      jwtSecret: "test-secret",
      sessionTtlSeconds: 3600,
      maxAttempts: 5,
      lockoutMins: 15
    }));
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" })
    });
      expect(response.status).toBe(401);
    });

    it("returns 401 on unknown username", async () => {
      const hash = await bcrypt.hash("secret", 10);
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use(createAuthRoutes({
        enabled: true,
        users: [{ username: "admin", passwordHash: hash, role: "admin" }],
        jwtSecret: "this-is-a-long-jwt-secret-value-123456",
        sessionTtlSeconds: 3600,
        maxAttempts: 2,
        lockoutMins: 15
      }));
      const baseUrl = await startApp(app);
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "ghost", password: "secret" })
      });
      expect(response.status).toBe(401);
      const body = await response.json() as { message: string };
      expect(body.message).not.toMatch(/\$2[aby]\$/);
    });

    it("rate limits after LOG_MAX_ATTEMPTS failed logins", async () => {
      const hash = await bcrypt.hash("secret", 10);
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use(createAuthRoutes({
        enabled: true,
        users: [{ username: "admin", passwordHash: hash, role: "admin" }],
        jwtSecret: "this-is-a-long-jwt-secret-value-123456",
        sessionTtlSeconds: 3600,
        maxAttempts: 1,
        lockoutMins: 1
      }));
      const baseUrl = await startApp(app);
      await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "bad" })
      });
      const blocked = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "bad" })
      });
      expect(blocked.status).toBe(429);
    });

    it("skips auth entirely when LOG_AUTH_ENABLED is false", async () => {
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use(createAuthRoutes({
        enabled: false,
        users: [],
        jwtSecret: "this-is-a-long-jwt-secret-value-123456",
        sessionTtlSeconds: 3600,
        maxAttempts: 5,
        lockoutMins: 15
      }));
      const baseUrl = await startApp(app);
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "any", password: "any" })
      });
      expect(response.status).toBe(200);
    });
  });
  describe("authMiddleware", () => {
    it("allows through when auth is disabled", async () => {
      const app = express();
      app.use(cookieParser());
      app.get("/logs", createAuthMiddleware({ enabled: false, jwtSecret: "secret" }), (_req, res) => {
        res.json({ ok: true });
      });
      const baseUrl = await startApp(app);
      const response = await fetch(`${baseUrl}/logs`);
      expect(response.status).toBe(200);
    });

    it("returns 401 for API routes with no cookie", async () => {
    const app = express();
    app.use(cookieParser());
    app.get("/logs", createAuthMiddleware({ enabled: true, jwtSecret: "secret" }), (_req, res) => {
      res.json({ ok: true });
    });
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/logs`);
    expect(response.status).toBe(401);
  });

  it("redirects HTML route without token", async () => {
    const app = express();
    app.use(cookieParser());
    app.get("/", createAuthMiddleware({ enabled: true, jwtSecret: "secret" }), (_req, res) => {
      res.status(200).send("ok");
    });
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("redirects mounted dashboard route to mounted login", async () => {
    const store = createInMemoryLogStore(100);
    store.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "seed", source: "test" });
    const app = express();
    app.use(createLoggerUIMiddleware({
      mountPath: "/viewer",
      authEnabled: true,
      jwtSecret: "secret",
      sessionTtl: 3600,
      maxAttempts: 5,
      lockoutMins: 15,
      users: []
    }, store));
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/viewer`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/viewer/login");
  });

  it("protects mounted API routes with unauthorized json", async () => {
    const store = createInMemoryLogStore(100);
    store.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "seed", source: "test" });
    const app = express();
    app.use(createLoggerUIMiddleware({
      mountPath: "/viewer",
      authEnabled: true,
      jwtSecret: "secret",
      sessionTtl: 3600,
      maxAttempts: 5,
      lockoutMins: 15,
      users: []
    }, store));
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/viewer/logs`);
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, message: "Unauthorized" });
  });
  });

  describe("POST /auth/logout", () => {
    it("returns ok true", async () => {
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use(createAuthRoutes({
        enabled: false,
        users: [],
        jwtSecret: "this-is-a-long-jwt-secret-value-123456",
        sessionTtlSeconds: 3600,
        maxAttempts: 5,
        lockoutMins: 15
      }));
      const baseUrl = await startApp(app);
      const response = await fetch(`${baseUrl}/auth/logout`, { method: "POST" });
      const body = await response.json() as { ok: boolean };
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });

  describe("hashPassword CLI", () => {
    it("generates a valid bcrypt hash from input", async () => {
      const originalArgv = process.argv;
      process.argv = ["node", "cli", "test-secret"];
      const writes: string[] = [];
      const originalLog = console.log;
      console.log = (message?: unknown): void => {
        writes.push(String(message ?? ""));
      };
      await runHashPasswordCli();
      console.log = originalLog;
      process.argv = originalArgv;
      expect(writes[0].startsWith("$2")).toBe(true);
    });

    it("prompts for password when argv is missing", async () => {
      const originalArgv = process.argv;
      process.argv = ["node", "cli"];
      const originalCreateInterface = readline.createInterface;
      (readline.createInterface as unknown as (options: unknown) => unknown) = () => {
        return {
          question: (_prompt: string, callback: (answer: string) => void): void => {
            callback("from-prompt");
          },
          close: (): void => {}
        };
      };
      const writes: string[] = [];
      const originalLog = console.log;
      console.log = (message?: unknown): void => {
        writes.push(String(message ?? ""));
      };
      await runHashPasswordCli();
      console.log = originalLog;
      process.argv = originalArgv;
      readline.createInterface = originalCreateInterface;
      expect(writes[0].startsWith("$2")).toBe(true);
    });
  });
});

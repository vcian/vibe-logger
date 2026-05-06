import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthRoutes } from "../src/auth/authRoutes";
import { createAuthMiddleware } from "../src/auth/authMiddleware";
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

describe("auth routes", () => {
  it("logs in successfully with valid credentials", async () => {
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
    expect(response.headers.get("set-cookie")).toContain("lgr_session=");
  });

  it("rejects invalid credentials", async () => {
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
});

describe("auth middleware", () => {
  it("returns unauthorized for protected API without token", async () => {
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

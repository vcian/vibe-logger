import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createLoggerUI } from "../src/index";
import { createInMemoryLogStore } from "../src/store/logStore";

describe("createLoggerUI", () => {
  const envKeys = ["LOG_STORAGE_MODE", "LOG_FILE_PATH", "LOG_FILE_LIVE_TAIL", "LOG_AUTH_ENABLED", "LOG_JWT_SECRET", "LOG_PASSWORD_HASH"];

  afterEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  it("uses an injected store for helper methods", () => {
    const store = createInMemoryLogStore(100);
    const logger = createLoggerUI({ store, source: "api" });

    logger.info("hello");
    logger.error("boom", { code: 500 });

    const result = store.query({ limit: 10, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.data.map((entry) => entry.message).sort()).toEqual(["boom", "hello"]);
  });

  it("honors env-backed file storage defaults", () => {
    const filePath = path.join(os.tmpdir(), `express-loglens-ui-${Date.now()}-index.log`);
    process.env.LOG_STORAGE_MODE = "file";
    process.env.LOG_FILE_PATH = filePath;
    process.env.LOG_FILE_LIVE_TAIL = "true";

    const logger = createLoggerUI({ source: "worker" });
    logger.warn("from env file mode");

    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).toContain("\"message\":\"from env file mode\"");
  });

  it("throws when auth is enabled but jwt secret is invalid", () => {
    process.env.LOG_AUTH_ENABLED = "true";
    process.env.LOG_PASSWORD_HASH = "$2b$10$abc123abc123abc123abc123abc123abc123abc123abc123abc123";
    process.env.LOG_JWT_SECRET = "short";
    expect(() => createLoggerUI({ source: "worker" })).toThrow("LOG_JWT_SECRET must be at least 32 characters long");
  });

  it("throws when auth is enabled and required env is missing", () => {
    process.env.LOG_AUTH_ENABLED = "true";
    delete process.env.LOG_PASSWORD_HASH;
    delete process.env.LOG_JWT_SECRET;
    expect(() => createLoggerUI({ source: "worker" })).toThrow("Missing required environment variables");
  });

  it("does not require auth env when auth is disabled", () => {
    process.env.LOG_AUTH_ENABLED = "false";
    delete process.env.LOG_PASSWORD_HASH;
    delete process.env.LOG_JWT_SECRET;
    const logger = createLoggerUI({ source: "worker" });
    logger.info("ok");
  });

  it("intercepts console when enabled", () => {
    process.env.LOG_AUTH_ENABLED = "false";
    const store = createInMemoryLogStore(100);
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug
    };
    console.log = (): void => {};
    console.info = (): void => {};
    console.warn = (): void => {};
    console.error = (): void => {};
    console.debug = (): void => {};
    const logger = createLoggerUI({ store, source: "api", interceptConsole: true });
    console.log("from log");
    console.info("from info");
    console.warn("from warn");
    console.error("from error");
    console.debug("from debug");
    logger.info("direct");
    const data = store.query({ limit: 10, offset: 0 }).data.map((entry) => entry.message);
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
    expect(data.join(" ")).toContain("from warn");
    expect(data.join(" ")).toContain("from debug");
  });
});

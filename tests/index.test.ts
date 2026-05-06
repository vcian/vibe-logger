import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createLoggerUI } from "../src/index";
import { createInMemoryLogStore } from "../src/store/logStore";

describe("createLoggerUI", () => {
  const envKeys = ["LOG_STORAGE_MODE", "LOG_FILE_PATH", "LOG_FILE_LIVE_TAIL"];

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
    expect(result.data[0].message).toBe("boom");
    expect(result.data[1].message).toBe("hello");
  });

  it("honors env-backed file storage defaults", () => {
    const filePath = path.join(os.tmpdir(), `logger-ui-${Date.now()}-index.log`);
    process.env.LOG_STORAGE_MODE = "file";
    process.env.LOG_FILE_PATH = filePath;
    process.env.LOG_FILE_LIVE_TAIL = "true";

    const logger = createLoggerUI({ source: "worker" });
    logger.warn("from env file mode");

    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).toContain("\"message\":\"from env file mode\"");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createInMemoryLogStore, LogStore } from "../src/store/logStore";
import { createFileBackedLogStore, createLogStore } from "../src/store/logStore";

describe("logStore", () => {
  let logStore: LogStore;

  beforeEach((): void => {
    logStore = createInMemoryLogStore(3);
    logStore.clear();
  });

  it("appends a log entry and returns it with an id", () => {
    const entry = logStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "a", source: "api" });
    expect(entry.id).toBeTypeOf("string");
    expect(entry.id.length).toBeGreaterThan(0);
  });

  it("generates a unique uuid for each entry", () => {
    const a = logStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "a", source: "api" });
    const b = logStore.append({ timestamp: "2026-01-01T00:00:01.000Z", level: "info", message: "b", source: "api" });
    expect(a.id).not.toBe(b.id);
  });

  it("respects LOG_MAX_ENTRIES limit and drops oldest entries", () => {
    logStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "1", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:00:01.000Z", level: "info", message: "2", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:00:02.000Z", level: "info", message: "3", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:00:03.000Z", level: "info", message: "4", source: "api" });
    const result = logStore.query({ limit: 10, offset: 0 });
    expect(result.total).toBe(3);
    expect(result.data.map(entry => entry.message)).toEqual(["4", "3", "2"]);
  });

  it("filters by level, source, search and date range", () => {
    logStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "error", message: "DB timeout", source: "db" });
    logStore.append({ timestamp: "2026-01-01T01:00:00.000Z", level: "warn", message: "API slow", source: "api" });
    const result = logStore.query({
      level: "error",
      source: "db",
      search: "timeout",
      startDate: "2025-12-31T23:00:00.000Z",
      endDate: "2026-01-01T00:30:00.000Z",
      limit: 10,
      offset: 0
    });
    expect(result.total).toBe(1);
    expect(result.data[0].message).toContain("timeout");
  });

  it("applies limit and offset and keeps total independent", () => {
    logStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "1", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:00:01.000Z", level: "info", message: "2", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:00:02.000Z", level: "info", message: "3", source: "api" });
    const result = logStore.query({ limit: 1, offset: 1 });
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(1);
  });

  it("returns correct stats and reset behavior", () => {
    logStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "a", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:10:00.000Z", level: "warn", message: "b", source: "auth" });
    const stats = logStore.stats();
    expect(stats.total).toBe(2);
    expect(stats.byLevel.info).toBe(1);
    expect(stats.byLevel.warn).toBe(1);
    expect(stats.byHour[0]).toHaveProperty("hour");
    logStore.clear();
    expect(logStore.stats().total).toBe(0);
  });

  it("returns unique source values and empty list when no sources", () => {
    expect(logStore.getSources()).toEqual([]);
    logStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "a", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:10:00.000Z", level: "warn", message: "b", source: "api" });
    logStore.append({ timestamp: "2026-01-01T00:20:00.000Z", level: "warn", message: "c", source: "auth" });
    expect(logStore.getSources()).toEqual(["api", "auth"]);
  });
});

describe("file-backed log store", () => {
  it("loads valid winston JSON lines and skips malformed lines", () => {
    const filePath = path.join(os.tmpdir(), `express-loglens-ui-${Date.now()}.log`);
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({
          timestamp: "2026-01-01T00:00:00.000Z",
          level: "info",
          message: "A",
          source: "api",
        }),
        "not-json",
        JSON.stringify({
          timestamp: "2026-02-26 16:18:18",
          level: "info",
          message: "Space timestamp",
          source: "api",
        }),
        JSON.stringify({
          timestamp: 1700000000,
          level: "warn",
          message: "Epoch seconds",
          source: "api",
        }),
        JSON.stringify({
          timestamp: 1700000000000,
          level: "warn",
          message: "Epoch ms",
          source: "api",
        }),
        JSON.stringify({
          timestamp: "not-a-date",
          level: "info",
          message: "Bad timestamp fallback",
          source: "api",
        }),
      ].join("\n")
    );
    const store = createFileBackedLogStore({ filePath, maxEntries: 100, liveTail: true });
    const result = store.query({ limit: 50, offset: 0 });
    expect(result.total).toBe(5);
    const bad = result.data.find(entry => entry.message === "Bad timestamp fallback");
    expect(bad?.meta?._timestampParseFailed).toBe(true);
  });

  it("supports append and clear", () => {
    const filePath = path.join(os.tmpdir(), `express-loglens-ui-${Date.now()}-2.log`);
    const store = createFileBackedLogStore({ filePath, maxEntries: 100, liveTail: true });
    store.append({
      timestamp: new Date().toISOString(),
      level: "debug",
      message: "hello",
      source: "worker",
    });
    expect(store.query({}).total).toBe(1);
    store.clear();
    expect(store.query({}).total).toBe(0);
  });

  it("creates stores via the factory for memory and file", () => {
    const memoryStore = createLogStore({ mode: "memory", maxEntries: 10 });
    memoryStore.append({
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "info",
      message: "mem",
      source: "api",
    });
    expect(memoryStore.query({}).total).toBe(1);

    const filePath = path.join(os.tmpdir(), `express-loglens-ui-${Date.now()}-factory.log`);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00.000Z",
        level: "warn",
        message: "factory",
        source: "worker",
      })
    );
    const fileStore = createLogStore({ mode: "file", filePath, maxEntries: 10, liveTail: true });
    expect(fileStore.query({}).total).toBe(1);
  });

  it("loads last N days from globbed daily files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "express-loglens-ui-glob-"));
    const today = new Date();
    for (let i = 0; i < 5; i += 1) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const filePath = path.join(dir, `${y}-${m}-${day}.log`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          timestamp: new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)
          ).toISOString(),
          level: "info",
          message: `m${i}`,
          source: "api",
        })
      );
    }
    const store = createLogStore({
      mode: "file",
      fileGlob: path.join(dir, "*.log"),
      days: 3,
      maxEntries: 10,
      liveTail: true,
    });
    const result = store.query({ limit: 50, offset: 0 });
    expect(result.total).toBe(3);
  });

  it("includes globbed files without YYYY-MM-DD in the filename using mtime for the day window", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "express-loglens-ui-glob-plain-"));
    const filePath = path.join(dir, "application.log");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "plain-name",
        source: "api",
      })
    );
    const store = createLogStore({
      mode: "file",
      fileGlob: path.join(dir, "*.log"),
      days: 30,
      maxEntries: 10,
      liveTail: true,
    });
    expect(store.query({}).total).toBe(1);
  });
});

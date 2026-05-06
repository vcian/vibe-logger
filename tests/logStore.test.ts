import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createFileBackedLogStore, createInMemoryLogStore, createLogStore } from "../src/store/logStore";

function formatYmdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("in-memory log store", () => {
  it("appends and queries with search + paging", () => {
    const store = createInMemoryLogStore(10);
    store.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "API ready", source: "api" });
    store.append({ timestamp: "2026-01-01T01:00:00.000Z", level: "error", message: "DB error", source: "database" });
    const result = store.query({ search: "db", limit: 25, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.data[0].level).toBe("error");
  });

  it("returns stats and unique sources", () => {
    const store = createInMemoryLogStore(10);
    store.append({ timestamp: "2026-01-01T00:10:00.000Z", level: "info", message: "x", source: "api" });
    store.append({ timestamp: "2026-01-01T00:20:00.000Z", level: "warn", message: "y", source: "auth" });
    const stats = store.stats();
    expect(stats.total).toBe(2);
    expect(stats.byLevel.warn).toBe(1);
    expect(store.getSources()).toEqual(["api", "auth"]);
  });
});

describe("file-backed log store", () => {
  it("loads valid winston JSON lines and skips malformed lines", () => {
    const filePath = path.join(os.tmpdir(), `logger-ui-${Date.now()}.log`);
    fs.writeFileSync(filePath, [
      JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "A", source: "api" }),
      "not-json",
      JSON.stringify({ timestamp: "2026-02-26 16:18:18", level: "info", message: "Space timestamp", source: "api" }),
      JSON.stringify({ timestamp: 1700000000, level: "warn", message: "Epoch seconds", source: "api" }),
      JSON.stringify({ timestamp: 1700000000000, level: "warn", message: "Epoch ms", source: "api" }),
      JSON.stringify({ timestamp: "not-a-date", level: "info", message: "Bad timestamp fallback", source: "api" }),
      JSON.stringify({ timestamp: "2026-01-01T01:00:00.000Z", level: "error", message: "B", source: "db" })
    ].join("\n"));
    const store = createFileBackedLogStore({ filePath, maxEntries: 100, liveTail: true });
    const result = store.query({ limit: 50, offset: 0 });
    expect(result.total).toBe(6);
    const bad = result.data.find((entry) => entry.message === "Bad timestamp fallback");
    expect(bad?.meta?._timestampParseFailed).toBe(true);
  });

  it("supports append and clear", () => {
    const filePath = path.join(os.tmpdir(), `logger-ui-${Date.now()}-2.log`);
    const store = createFileBackedLogStore({ filePath, maxEntries: 100, liveTail: true });
    store.append({ timestamp: new Date().toISOString(), level: "debug", message: "hello", source: "worker" });
    expect(store.query({}).total).toBe(1);
    store.clear();
    expect(store.query({}).total).toBe(0);
  });

  it("creates stores via the pluggable factory", () => {
    const memoryStore = createLogStore({ mode: "memory", maxEntries: 10 });
    memoryStore.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "mem", source: "api" });
    expect(memoryStore.query({}).total).toBe(1);

    const filePath = path.join(os.tmpdir(), `logger-ui-${Date.now()}-factory.log`);
    fs.writeFileSync(filePath, JSON.stringify({
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "warn",
      message: "factory",
      source: "worker"
    }));
    const fileStore = createLogStore({ mode: "file", filePath, maxEntries: 10, liveTail: true });
    expect(fileStore.query({}).total).toBe(1);
  });

  it("keeps query/filter behavior in parity with memory mode", () => {
    const fixture = [
      { timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "api ready", source: "api" },
      { timestamp: "2026-01-01T01:00:00.000Z", level: "warn", message: "token near expiry", source: "auth" },
      { timestamp: "2026-01-01T02:00:00.000Z", level: "error", message: "db timeout", source: "database" },
      { timestamp: "2026-01-01T03:00:00.000Z", level: "debug", message: "worker heartbeat", source: "worker" },
      { timestamp: "2026-01-01T04:00:00.000Z", level: "error", message: "db timeout retried", source: "database" }
    ] as const;

    const memoryStore = createInMemoryLogStore(100);
    for (const entry of fixture) {
      memoryStore.append(entry);
    }

    const filePath = path.join(os.tmpdir(), `logger-ui-${Date.now()}-parity.log`);
    fs.writeFileSync(filePath, fixture.map((entry) => JSON.stringify(entry)).join("\n"));
    const fileStore = createFileBackedLogStore({ filePath, maxEntries: 100, liveTail: true });

    const options = {
      level: "error",
      source: "database",
      search: "timeout",
      startDate: "2026-01-01T00:30:00.000Z",
      endDate: "2026-01-01T05:00:00.000Z",
      limit: 10,
      offset: 0
    };

    const memoryResult = memoryStore.query(options);
    const fileResult = fileStore.query(options);

    expect(fileResult.total).toBe(memoryResult.total);
    expect(fileResult.data.map((entry) => entry.message)).toEqual(
      memoryResult.data.map((entry) => entry.message)
    );
    expect(fileStore.getSources()).toEqual(memoryStore.getSources());
    expect(fileStore.stats().byLevel).toEqual(memoryStore.stats().byLevel);
  });

  it("loads last N days from globbed daily files and enforces maxEntries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-ui-glob-"));
    const today = new Date();
    const makeFile = (daysAgo: number, lines: Array<Record<string, unknown>>) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - daysAgo);
      const filePath = path.join(dir, `${formatYmdUtc(d)}.log`);
      fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
      return filePath;
    };

    // Create 5 daily files: 0..4 days ago, 2 entries each.
    for (let i = 0; i < 5; i += 1) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      makeFile(i, [
        { timestamp: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)).toISOString(), level: "info", message: `m${i}-a`, source: "api" },
        { timestamp: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13)).toISOString(), level: "warn", message: `m${i}-b`, source: "auth" }
      ]);
    }

    const store = createLogStore({
      mode: "file",
      fileGlob: path.join(dir, "*.log"),
      days: 3,
      maxEntries: 4,
      liveTail: true
    });

    // Last 3 days => 6 entries, but maxEntries => only newest 4 should remain.
    const result = store.query({ limit: 50, offset: 0 });
    expect(result.total).toBe(4);
    // Newest entry should be from today at 13:00Z.
    expect(result.data[0].message).toBe("m0-b");
    // Oldest retained should be within last 3 days.
    expect(result.data[result.data.length - 1].message.startsWith("m2-") || result.data[result.data.length - 1].message.startsWith("m1-")).toBe(true);
  });
});

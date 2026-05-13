import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { createLogRoutes } from "../src/routes/logRoutes";
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

describe("log routes", () => {
  it("returns paged logs data shape", async () => {
    const store = createInMemoryLogStore(100);
    store.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", message: "a", source: "api" });
    const app = express();
    app.use("/logs", createLogRoutes(store));
    const baseUrl = await startApp(app);

    const response = await fetch(`${baseUrl}/logs?limit=25&offset=0`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
  });

  it("exports csv with attachment filename", async () => {
    const store = createInMemoryLogStore(100);
    store.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "warn", message: "b", source: "auth" });
    const app = express();
    app.use("/logs", createLogRoutes(store));
    const baseUrl = await startApp(app);

    const response = await fetch(`${baseUrl}/logs/export/csv`);
    const disposition = response.headers.get("content-disposition") ?? "";
    const text = await response.text();
    expect(disposition).toContain("attachment; filename=\"logs-");
    expect(text.split("\n")[0]).toBe("id,timestamp,level,source,message,meta");
  });

  it("filters by level query param", async () => {
    const store = createInMemoryLogStore(100);
    store.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "warn", message: "b", source: "auth" });
    store.append({ timestamp: "2026-01-01T01:00:00.000Z", level: "info", message: "a", source: "api" });
    const app = express();
    app.use("/logs", createLogRoutes(store));
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/logs?level=warn`);
    const body = await response.json();
    expect(body.total).toBe(1);
  });

  it("filters by search query param (message and meta)", async () => {
    const store = createInMemoryLogStore(100);
    store.append({
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "info",
      message: "hello world",
      source: "api",
    });
    store.append({
      timestamp: "2026-01-01T01:00:00.000Z",
      level: "info",
      message: "other",
      source: "worker",
      meta: { traceId: "abc-xyz-99" },
    });
    const app = express();
    app.use("/logs", createLogRoutes(store));
    const baseUrl = await startApp(app);

    const byMessage = await fetch(`${baseUrl}/logs?search=hello`);
    const bodyMessage = await byMessage.json();
    expect(bodyMessage.total).toBe(1);
    expect(bodyMessage.data[0].message).toContain("hello");

    const byMeta = await fetch(`${baseUrl}/logs?search=xyz-99`);
    const bodyMeta = await byMeta.json();
    expect(bodyMeta.total).toBe(1);
    expect(bodyMeta.data[0].message).toBe("other");
  });

  it("returns stats shape", async () => {
    const store = createInMemoryLogStore(100);
    store.append({ timestamp: "2026-01-01T00:00:00.000Z", level: "warn", message: "b", source: "auth" });
    const app = express();
    app.use("/logs", createLogRoutes(store));
    const baseUrl = await startApp(app);
    const response = await fetch(`${baseUrl}/logs/stats`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toHaveProperty("total");
    expect(body.data).toHaveProperty("byLevel");
    expect(body.data).toHaveProperty("byHour");
  });
});

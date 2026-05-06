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
});

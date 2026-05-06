import dotenv from "dotenv";
import express from "express";
import { createLoggerUI } from "./index";

dotenv.config();

const app = express();

const logger = createLoggerUI({
  path: "/logs",
  interceptConsole: false,
  source: "demo-app",
  storageMode: "memory"
});

app.use(logger.middleware());

const sources: string[] = ["api", "auth", "database", "worker", "scheduler"];
const levels: Array<"info" | "warn" | "error" | "debug"> = ["info", "warn", "error", "debug"];
const baseTime: Date = new Date();
baseTime.setMinutes(0, 0, 0);

for (let i = 0; i < 50; i += 1) {
  const level = levels[i % levels.length];
  const source = sources[i % sources.length];
  const timestamp: Date = new Date(baseTime);
  timestamp.setHours(baseTime.getHours() - (i % 24));
  timestamp.setMinutes((i * 7) % 60, 0, 0);
  const message: string = `${source} ${level} event ${i + 1}`;
  const meta = { requestId: `req-${1000 + i}`, host: "demo.local", sequence: i + 1, _timestamp: timestamp.toISOString() };
  const storeLogger = logger[level].bind(logger);
  storeLogger(message, meta);
}

app.get("/", (_req, res) => {
  res.redirect("/logs");
});

app.listen(3000, () => {
  // eslint-disable-next-line no-console
  console.log("Demo running at http://localhost:3000/logs");
});

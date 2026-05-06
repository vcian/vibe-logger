# express-loglens-ui

Drop-in log viewer UI for Node.js/Express with search, filters, chart, CSV export, and optional auth.

## Installation

```bash
npm install express-loglens-ui
```

## Environment Setup

1. Copy `.env.example` into your app as `.env`.
2. Generate a password hash:
   ```bash
   npx express-loglens-ui hash-password "your-password"
   ```
   If `npx` does not resolve the binary in your environment, run:
   ```bash
   node ./node_modules/express-loglens-ui/dist/cli.js "your-password"
   ```
3. Put the hash into `LOG_PASSWORD_HASH`.

## Usage

```ts
import express from "express";
import { createLoggerUI } from "express-loglens-ui";

const app = express();

const logger = createLoggerUI({
  path: "/logs",
  interceptConsole: true,
  source: "my-app",
  storageMode: "file",
  filePath: "logs/application.log",
  fileLiveTail: true
});

app.use(logger.middleware());

logger.info("Server started", { port: 3000 });
logger.warn("High memory", { mb: 512 });
logger.error("DB failed", { code: "DB_DOWN" });
logger.debug("Cache miss", { key: "user:42" });
```

## Writing Logs

The viewer shows only the **first line** of each message in the table and tucks the rest into an expandable detail panel. Structuring your logs around this pattern keeps the table scannable while preserving full context for debugging.

### Recommended shape

Use a short, scannable first line as the summary. Push verbose context (stack traces, payloads) into subsequent lines of the message or, preferably, into the structured `meta` object.

```ts
logger.info("Request complete", { method: "GET", path: "/users", status: 200, durationMs: 42 });
logger.warn("Slow query detected", { sqlHash: "ab12", durationMs: 1800, rows: 3200 });
logger.error("Failed to charge customer", { customerId: "cus_123", provider: "stripe", code: "card_declined" });
```

### Logging errors with stack traces

Put the exception's one-line summary first, followed by the full stack trace on subsequent lines. The viewer will:

- Show only the first line in the table row, with a `▸` caret indicating more content is available.
- Reveal the complete stack trace inside a scrollable **Full message** block when the row is expanded.
- Render the `meta` object as a pretty-printed **Metadata** block below the trace.

```ts
try {
  await userService.load(id);
} catch (error) {
  logger.error(
    `${error.name}: ${error.message}\n${error.stack}`,
    { requestId: req.id, userId: id }
  );
}
```

For Express/Nest error middleware, this shape works well:

```ts
app.use((err, req, _res, next) => {
  logger.error(
    `${err.name ?? "Error"}: ${err.message}\n${err.stack ?? ""}`,
    { method: req.method, url: req.originalUrl, ip: req.ip, statusCode: err.status ?? 500 }
  );
  next(err);
});
```

### Structured metadata

The second argument (`meta`) is serialized as JSON and shown inside the expanded detail view. Prefer flat, consistent keys so filtering and CSV export stay useful:

- Good: `{ requestId, userId, route, durationMs, statusCode }`
- Avoid: deeply nested objects, circular references, or embedding full request/response bodies.
- `meta._timestamp` (ISO string) overrides the ingestion timestamp if you're replaying historical events.

### Choosing a level

The level drives the chart, metric cards, insights, and filters — keep it aligned with intent:

| Level | Use for |
|---|---|
| `info` | Normal lifecycle events, successful requests, state transitions |
| `warn` | Recoverable issues, slow operations, deprecation hits |
| `error` | Thrown exceptions, failed jobs, 5xx responses |
| `debug` | Verbose diagnostics for non-production environments |

### Capturing `console.*` from legacy code

Set `interceptConsole: true` when calling `createLoggerUI` to forward `console.log/info/warn/error/debug` into the store automatically. Legacy modules that still write to `console` will show up in the viewer with no refactor needed — multi-line traces will be truncated in the table and expandable just like explicit `logger.error` calls.

## Demo App

Run the local demo with seeded events:

```bash
npm run dev
```

Then open `http://localhost:3000/logs`. The demo seeds 50 logs across a 24-hour window using `api`, `auth`, `database`, `worker`, and `scheduler` sources.

## Viewing Logs

Open the mount path (`/logs` by default) in a browser. The dashboard is organized top-down for fast triage.

### Metric cards and volume chart

- **Total Logs**, **Errors**, **Warnings**, and **Info** cards summarize the current filter set.
- **Log Volume by Hour** is a stacked bar chart coloured by level. Click a bar to drill into logs for that hour; click the active bar again to clear.

### Filter toolbar

A single compact bar containing:

- **Search** — debounced substring match against message and source; matches are highlighted inline in the table.
- **Level** and **Source** dropdowns.
- **Date range** — quick presets (`Last 1h`, `Last 24h`, `Last 7d`) plus `Custom` with `From` / `To` date-time inputs and `Apply` / `Cancel` / `Clear` controls. Validation is inline (end must be after start).
- **Clear Filters** resets all controls.
- **Export CSV** downloads the currently filtered set.

Active filters appear as removable chips below the toolbar.

### Log table

- Columns: **Timestamp**, **Level** (coloured badge), **Source**, **Message**.
- Each row shows only the **first line** of the message so the table stays one-line-per-entry even for logs containing stack traces.
- A `▸` caret in front of the message marks rows that have additional content (stack traces, multi-line output, or metadata).
- Click a row to expand it; click again to collapse. The detail panel shows:
  - **Full message** — the complete multi-line content, monospaced and scrollable.
  - **Metadata** — the `meta` payload as pretty-printed JSON.
- Error rows are flagged with a red left border for quick scanning.

### Quality insights

The insights panel recomputes against the active filters so you can narrow to a level/source/date range and inspect quality in context.

## Dashboard Insights

The dashboard includes a **Log Quality Insights** panel to help triage issues faster:

- **Error Rate / Warn Rate**: quick health signal for current filters.
- **Top Noisy Sources**: sources with the highest volume, including source-level error rate.
- **Recurring Error Messages**: most repeated error messages to identify hotspots.
- **Spike Hours**: hours with unusually high activity or error concentration.

All insights are computed from the currently active filters, so you can narrow to a level/source/date range and inspect quality in context.

## Date Range UX

Date filtering is optimized for fast analysis:

- Use quick presets: `Last 1h`, `Last 24h`, `Last 7d`.
- Choose `Custom` for manual start/end date-time input.
- Click **Apply** to run the filter (no click-outside required).
- Click **Cancel** to discard in-progress edits and restore the applied range.
- Click **Clear** to remove date filtering.

Validation is inline and prevents invalid ranges (for example, end date before start date).

## Configuration Reference

| Key | Default | Description |
|---|---|---|
| `LOG_AUTH_ENABLED` | `true` | Enable/disable auth checks |
| `LOG_USERNAME` | `admin` | Single-user username |
| `LOG_PASSWORD_HASH` | empty | Bcrypt hash for single-user mode |
| `LOG_JWT_SECRET` | required | JWT signing secret |
| `LOG_SESSION_TTL` | `3600` | Session TTL in seconds |
| `LOG_MAX_ATTEMPTS` | `5` | Login attempts before lockout |
| `LOG_LOCKOUT_MINS` | `15` | Lockout duration in minutes |
| `LOG_USERS` | empty | Optional JSON array of users |
| `LOG_VIEWER_PATH` | `/logs` | Mount path |
| `LOG_MAX_ENTRIES` | `10000` | In-memory cap or loaded-file cap |
| `LOG_STORAGE_MODE` | `memory` | `memory` or `file` |
| `LOG_FILE_PATH` | `logs/app.log` | Winston JSON file path |
| `LOG_FILE_GLOB` | empty | Optional glob (e.g. `logs/*.log`) to read multiple daily files |
| `LOG_FILE_DAYS` | `30` | Days to include when using `LOG_FILE_GLOB` (based on `YYYY-MM-DD` in filenames) |
| `LOG_FILE_LIVE_TAIL` | `true` | Reload file when modified |

## API Reference

### `createLoggerUI(options?)`

Creates and returns a logger instance with middleware and helper log methods.

Options:

- `path?: string` - Mount path for viewer routes (default: `"/logs"` or `LOG_VIEWER_PATH`).
- `interceptConsole?: boolean` - Captures `console.*` output into the store.
- `source?: string` - Default source label for helper methods.
- `storageMode?: "memory" | "file"` - Explicit storage mode override.
- `maxEntries?: number` - Entry cap for memory and file-backed stores.
- `filePath?: string` - Path to Winston JSON log file in file mode.
- `fileLiveTail?: boolean` - Reloads log file on file updates.
- `store?: LogStore` - Inject a custom/in-memory/file store implementation.

Returned object:

- `middleware(): Router` - Mountable Express router for UI + API routes.
- `info(message, meta?)`
- `warn(message, meta?)`
- `error(message, meta?)`
- `debug(message, meta?)`

## Winston File Mode

- Use JSON log lines (one JSON object per line).
- Supported keys: `timestamp`, `level`, `message`, `source`, `meta`.
- Extra keys are collected into `meta`.
- Malformed lines are skipped safely.
- Enable `LOG_FILE_LIVE_TAIL=true` to refresh the viewer as the log file changes.

Timestamp parsing is tolerant and accepts common formats:

- ISO strings (e.g. `2026-01-01T12:00:00.000Z`)
- Space-separated Winston timestamps (e.g. `2026-02-26 16:18:18`)
- Epoch seconds or milliseconds (number or numeric string)

If a timestamp can’t be parsed, the entry is still ingested with the current time and `meta._timestampParseFailed=true`.

### Daily rotate (multi-file)

If your app writes one log file per day (e.g. `logs/2026-03-10.log`), configure:

- `LOG_STORAGE_MODE=file`
- `LOG_FILE_GLOB=logs/*.log`
- `LOG_FILE_DAYS=30`

Notes:

- Filenames must contain a `YYYY-MM-DD` date for day filtering.
- `LOG_FILE_GLOB` takes precedence over `LOG_FILE_PATH` (unless you pass `filePath` directly to `createLoggerUI`).

Example line:

```json
{"timestamp":"2026-01-01T12:00:00.000Z","level":"info","message":"Request complete","source":"api","meta":{"status":200,"durationMs":42}}
```

## NestJS Compatibility

`express-loglens-ui` mounts directly in Express apps and in NestJS apps using the Express adapter. If your Nest app uses Fastify, you need an adapter bridge before mounting this middleware.


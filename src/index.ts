import { Router } from "express";
import { createLoggerUIMiddleware } from "./middleware";
import {
  createLogStore,
  CreateLogStoreOptions,
  LogEntry,
  LogLevel,
  LogStore,
  StorageMode
} from "./store/logStore";

export interface CreateLoggerUIOptions {
  path?: string;
  interceptConsole?: boolean;
  source?: string;
  storageMode?: StorageMode;
  maxEntries?: number;
  filePath?: string;
  fileLiveTail?: boolean;
  store?: LogStore;
}

export interface LoggerUI {
  middleware(): Router;
  info(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
  debug(message: string, meta?: object): void;
}

interface AppUser {
  username: string;
  passwordHash: string;
  role: string;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  const parsed: number = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return parsed;
}

function loadUsers(): AppUser[] {
  const fromJson: string = process.env.LOG_USERS ?? "";
  if (fromJson.trim()) {
    try {
      const parsed: unknown = JSON.parse(fromJson);
      if (Array.isArray(parsed)) {
        return parsed.map((user: unknown): AppUser => {
          const mapped: Record<string, unknown> = user as Record<string, unknown>;
          return {
            username: String(mapped.username ?? ""),
            passwordHash: String(mapped.passwordHash ?? ""),
            role: String(mapped.role ?? "viewer")
          };
        });
      }
    } catch (_error) {
      return [];
    }
  }
  return [{
    username: process.env.LOG_USERNAME ?? "admin",
    passwordHash: process.env.LOG_PASSWORD_HASH ?? "",
    role: "admin"
  }];
}

function append(store: LogStore, level: LogLevel, source: string, message: string, meta?: object): LogEntry {
  const rawMeta: Record<string, unknown> | undefined = meta as Record<string, unknown> | undefined;
  const timestampFromMeta: string | undefined = typeof rawMeta?._timestamp === "string" ? String(rawMeta._timestamp) : undefined;
  const sanitizedMeta: Record<string, unknown> | undefined = rawMeta
    ? Object.fromEntries(Object.entries(rawMeta).filter(([key]) => key !== "_timestamp"))
    : undefined;
  return store.append({
    timestamp: timestampFromMeta ?? new Date().toISOString(),
    level,
    message,
    source,
    meta: sanitizedMeta
  });
}

function interceptConsole(store: LogStore, source: string): void {
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  console.info = (...args: unknown[]): void => {
    append(store, "info", source, args.map(String).join(" "));
    original.info(...args);
  };
  console.log = (...args: unknown[]): void => {
    append(store, "info", source, args.map(String).join(" "));
    original.log(...args);
  };
  console.warn = (...args: unknown[]): void => {
    append(store, "warn", source, args.map(String).join(" "));
    original.warn(...args);
  };
  console.error = (...args: unknown[]): void => {
    append(store, "error", source, args.map(String).join(" "));
    original.error(...args);
  };
  console.debug = (...args: unknown[]): void => {
    append(store, "debug", source, args.map(String).join(" "));
    original.debug(...args);
  };
}

export function createLoggerUI(options: CreateLoggerUIOptions = {}): LoggerUI {
  const mountPath: string = options.path ?? process.env.LOG_VIEWER_PATH ?? "/logs";
  const defaultSource: string = options.source ?? "app";
  const maxEntries: number = options.maxEntries ?? parseNumber(process.env.LOG_MAX_ENTRIES, 10000);
  const storageModeEnv: string | undefined = process.env.LOG_STORAGE_MODE;
  const storageMode: StorageMode = options.storageMode
    ?? (storageModeEnv === "file" ? "file" : "memory");

  const storeOptions: CreateLogStoreOptions = storageMode === "file"
    ? (() => {
      const liveTail: boolean = options.fileLiveTail ?? parseBoolean(process.env.LOG_FILE_LIVE_TAIL, true);
      if (options.filePath) {
        return {
          mode: "file",
          filePath: options.filePath,
          maxEntries,
          liveTail
        };
      }
      const fileGlob: string = (process.env.LOG_FILE_GLOB ?? "").trim();
      if (fileGlob) {
        const days: number = parseNumber(process.env.LOG_FILE_DAYS, 30);
        return {
          mode: "file",
          fileGlob,
          days,
          maxEntries,
          liveTail
        };
      }
      return {
        mode: "file",
        filePath: process.env.LOG_FILE_PATH ?? "logs/app.log",
        maxEntries,
        liveTail
      };
    })()
    : {
      mode: "memory",
      maxEntries
    };
  const store: LogStore = options.store ?? createLogStore(storeOptions);

  const authEnabled: boolean = parseBoolean(process.env.LOG_AUTH_ENABLED, true);
  const jwtSecret: string = process.env.LOG_JWT_SECRET ?? "change-this-to-a-long-random-string";
  const sessionTtl: number = parseNumber(process.env.LOG_SESSION_TTL, 3600);
  const maxAttempts: number = parseNumber(process.env.LOG_MAX_ATTEMPTS, 5);
  const lockoutMins: number = parseNumber(process.env.LOG_LOCKOUT_MINS, 15);
  const users: AppUser[] = loadUsers();

  if (options.interceptConsole) {
    interceptConsole(store, defaultSource);
  }

  return {
    middleware(): Router {
      return createLoggerUIMiddleware({
        mountPath,
        authEnabled,
        jwtSecret,
        sessionTtl,
        maxAttempts,
        lockoutMins,
        users
      }, store);
    },
    info(message: string, meta?: object): void {
      append(store, "info", defaultSource, message, meta);
    },
    warn(message: string, meta?: object): void {
      append(store, "warn", defaultSource, message, meta);
    },
    error(message: string, meta?: object): void {
      append(store, "error", defaultSource, message, meta);
    },
    debug(message: string, meta?: object): void {
      append(store, "debug", defaultSource, message, meta);
    }
  };
}

export * from "./store/logStore";

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  meta?: Record<string, unknown>;
}

export interface QueryOptions {
  level?: string;
  source?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface HourBucket {
  hour: string;
  info: number;
  warn: number;
  error: number;
  debug: number;
}

export interface QueryResult {
  data: LogEntry[];
  total: number;
}

export interface StatsResult {
  total: number;
  byLevel: Record<string, number>;
  byHour: HourBucket[];
  errorRate: number;
  warnRate: number;
  topNoisySources: SourceInsight[];
  topErrorMessages: ErrorMessageInsight[];
  spikeHours: SpikeHourInsight[];
}

export interface SourceInsight {
  source: string;
  total: number;
  errorCount: number;
  errorRate: number;
}

export interface ErrorMessageInsight {
  message: string;
  count: number;
  sources: string[];
}

export interface SpikeHourInsight {
  hour: string;
  total: number;
  errorCount: number;
  totalDelta: number;
  errorDelta: number;
}

export interface LogStore {
  append(entry: Omit<LogEntry, 'id'>): LogEntry;
  query(options: QueryOptions): QueryResult;
  stats(): StatsResult;
  clear(): void;
  getSources(): string[];
}

export interface SingleFileStoreOptions {
  filePath: string;
  maxEntries: number;
  liveTail?: boolean;
}

export interface GlobFileStoreOptions {
  fileGlob: string;
  days: number;
  maxEntries: number;
  liveTail?: boolean;
}

export type StorageMode = 'memory' | 'file';

export interface InMemoryStoreOptions {
  maxEntries: number;
}

export type CreateLogStoreOptions =
  | ({ mode?: 'memory' } & InMemoryStoreOptions)
  | ({ mode: 'file' } & (SingleFileStoreOptions | GlobFileStoreOptions));

function normalizeLevel(level: string): LogLevel {
  if (level === 'info' || level === 'warn' || level === 'error' || level === 'debug') {
    return level;
  }
  return 'info';
}

function sanitizeEntry(entry: Omit<LogEntry, 'id'>): LogEntry {
  return {
    id: randomUUID(),
    timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString(),
    level: normalizeLevel(entry.level),
    message: String(entry.message ?? ''),
    source: entry.source ? String(entry.source) : undefined,
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : undefined,
  };
}

function enforceLimit(entries: LogEntry[], maxEntries: number): LogEntry[] {
  if (entries.length <= maxEntries) {
    return entries;
  }
  return entries.slice(entries.length - maxEntries);
}

function filterEntries(entries: LogEntry[], options: QueryOptions): LogEntry[] {
  const startMs: number | null = options.startDate ? Date.parse(options.startDate) : null;
  const endMs: number | null = options.endDate ? Date.parse(options.endDate) : null;
  const searchValue: string = (options.search ?? '').trim().toLowerCase();

  return entries.filter((entry: LogEntry): boolean => {
    if (options.level && options.level !== 'all' && entry.level !== options.level) {
      return false;
    }
    if (options.source && options.source !== 'all' && (entry.source ?? '') !== options.source) {
      return false;
    }

    const timeMs: number = Date.parse(entry.timestamp);
    if (startMs !== null && !Number.isNaN(startMs) && timeMs < startMs) {
      return false;
    }
    if (endMs !== null && !Number.isNaN(endMs) && timeMs > endMs) {
      return false;
    }
    if (searchValue) {
      const metaStr: string =
        entry.meta && typeof entry.meta === 'object'
          ? JSON.stringify(entry.meta)
          : '';
      const haystack: string = `${entry.message} ${entry.source ?? ''} ${metaStr}`.toLowerCase();
      if (!haystack.includes(searchValue)) {
        return false;
      }
    }
    return true;
  });
}

function queryEntries(entries: LogEntry[], options: QueryOptions): QueryResult {
  const filtered: LogEntry[] = filterEntries(entries, options);
  const sorted: LogEntry[] = filtered.slice().sort((a: LogEntry, b: LogEntry): number => {
    return Date.parse(b.timestamp) - Date.parse(a.timestamp);
  });
  const limit: number = Number.isFinite(options.limit) ? Math.max(1, Number(options.limit)) : 25;
  const offset: number = Number.isFinite(options.offset) ? Math.max(0, Number(options.offset)) : 0;

  return {
    data: sorted.slice(offset, offset + limit),
    total: sorted.length,
  };
}

function buildStats(entries: LogEntry[]): StatsResult {
  const byLevel: Record<string, number> = { info: 0, warn: 0, error: 0, debug: 0 };
  const byHourMap: Map<string, HourBucket> = new Map<string, HourBucket>();
  const sourceMap: Map<string, { total: number; errorCount: number }> = new Map<
    string,
    { total: number; errorCount: number }
  >();
  const errorMessageMap: Map<string, { count: number; sample: string; sources: Set<string> }> =
    new Map<string, { count: number; sample: string; sources: Set<string> }>();

  const normalizeErrorMessage = (message: string): string => {
    return message
      .toLowerCase()
      .replace(/\b\d+\b/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const summarizeErrorMessage = (message: string): string => {
    const firstLine: string =
      String(message ?? '')
        .split(/\r?\n/)[0]
        ?.trim() || '(empty message)';
    const withoutPathNoise: string = firstLine
      .replace(/\([^)]*[\\/][^)]*\)/g, '()')
      .replace(/\s+/g, ' ')
      .trim();
    const maxLength: number = 140;
    if (withoutPathNoise.length <= maxLength) {
      return withoutPathNoise;
    }
    return `${withoutPathNoise.slice(0, maxLength - 1)}...`;
  };

  const readNestedString = (value: unknown, key: string): string => {
    if (!value || typeof value !== 'object') {
      return '';
    }
    const nested = (value as Record<string, unknown>)[key];
    if (typeof nested === 'string') {
      return nested.trim();
    }
    return '';
  };

  const getEntryErrorText = (entry: LogEntry): string => {
    const direct: string = String(entry.message ?? '').trim();
    if (direct) {
      return direct;
    }

    const meta: Record<string, unknown> = entry.meta ?? {};
    const metaMessage: string = readNestedString(meta, 'message');
    if (metaMessage) {
      return metaMessage;
    }

    const errorMessage: string = readNestedString(meta.error, 'message');
    if (errorMessage) {
      return errorMessage;
    }

    const stackCandidate: unknown =
      meta.stack ??
      (meta.error && typeof meta.error === 'object'
        ? (meta.error as Record<string, unknown>).stack
        : undefined);
    if (typeof stackCandidate === 'string' && stackCandidate.trim()) {
      return stackCandidate.split(/\r?\n/)[0].trim();
    }

    return '(unlabeled error)';
  };

  for (const entry of entries) {
    byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1;
    const date: Date = new Date(entry.timestamp);
    date.setMinutes(0, 0, 0);
    const hour: string = date.toISOString();
    const bucket: HourBucket = byHourMap.get(hour) ?? {
      hour,
      info: 0,
      warn: 0,
      error: 0,
      debug: 0,
    };
    bucket[entry.level] += 1;
    byHourMap.set(hour, bucket);

    const source: string = (entry.source ?? 'unknown').trim() || 'unknown';
    const sourceBucket = sourceMap.get(source) ?? { total: 0, errorCount: 0 };
    sourceBucket.total += 1;
    if (entry.level === 'error') {
      sourceBucket.errorCount += 1;
    }
    sourceMap.set(source, sourceBucket);

    if (entry.level === 'error') {
      const errorText: string = getEntryErrorText(entry);
      const key: string = normalizeErrorMessage(errorText);
      const errorBucket = errorMessageMap.get(key) ?? {
        count: 0,
        sample: summarizeErrorMessage(errorText),
        sources: new Set<string>(),
      };
      errorBucket.count += 1;
      if (entry.source) {
        errorBucket.sources.add(entry.source);
      }
      errorMessageMap.set(key, errorBucket);
    }
  }

  const byHour: HourBucket[] = [...byHourMap.values()].sort(
    (a: HourBucket, b: HourBucket): number => {
      return Date.parse(a.hour) - Date.parse(b.hour);
    }
  );

  const totalCount: number = entries.length;
  const safeRate = (value: number): number => {
    if (totalCount === 0) {
      return 0;
    }
    return Number(((value / totalCount) * 100).toFixed(1));
  };

  const topNoisySources: SourceInsight[] = [...sourceMap.entries()]
    .map(([source, values]: [string, { total: number; errorCount: number }]) => ({
      source,
      total: values.total,
      errorCount: values.errorCount,
      errorRate:
        values.total > 0 ? Number(((values.errorCount / values.total) * 100).toFixed(1)) : 0,
    }))
    .sort((a: SourceInsight, b: SourceInsight): number => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return b.errorRate - a.errorRate;
    })
    .slice(0, 5);

  const topErrorMessages: ErrorMessageInsight[] = [...errorMessageMap.values()]
    .map(bucket => ({
      message: bucket.sample,
      count: bucket.count,
      sources: [...bucket.sources].sort(),
    }))
    .sort((a: ErrorMessageInsight, b: ErrorMessageInsight): number => b.count - a.count)
    .slice(0, 5);

  const median = (values: number[]): number => {
    if (!values.length) {
      return 0;
    }
    const sorted: number[] = values.slice().sort((a: number, b: number): number => a - b);
    const mid: number = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  };

  const hourTotals: number[] = byHour.map((bucket: HourBucket): number => {
    return bucket.info + bucket.warn + bucket.error + bucket.debug;
  });
  const hourErrors: number[] = byHour.map((bucket: HourBucket): number => bucket.error);
  const medianTotal: number = median(hourTotals);
  const medianError: number = median(hourErrors);
  const totalThreshold: number = Math.max(3, medianTotal * 2);
  const errorThreshold: number = Math.max(2, medianError * 2);

  const spikeHours: SpikeHourInsight[] = byHour
    .map((bucket: HourBucket): SpikeHourInsight => {
      const total: number = bucket.info + bucket.warn + bucket.error + bucket.debug;
      return {
        hour: bucket.hour,
        total,
        errorCount: bucket.error,
        totalDelta: Number((total - medianTotal).toFixed(1)),
        errorDelta: Number((bucket.error - medianError).toFixed(1)),
      };
    })
    .filter((bucket: SpikeHourInsight): boolean => {
      return bucket.total >= totalThreshold || bucket.errorCount >= errorThreshold;
    })
    .sort((a: SpikeHourInsight, b: SpikeHourInsight): number => {
      if (b.errorCount !== a.errorCount) {
        return b.errorCount - a.errorCount;
      }
      return b.total - a.total;
    })
    .slice(0, 5);

  return {
    total: totalCount,
    byLevel,
    byHour,
    errorRate: safeRate(byLevel.error ?? 0),
    warnRate: safeRate(byLevel.warn ?? 0),
    topNoisySources,
    topErrorMessages,
    spikeHours,
  };
}

export function createInMemoryLogStore(maxEntries: number): LogStore {
  let entries: LogEntry[] = [];

  return {
    append(entry: Omit<LogEntry, 'id'>): LogEntry {
      const saved: LogEntry = sanitizeEntry(entry);
      entries.push(saved);
      entries = enforceLimit(entries, maxEntries);
      return saved;
    },
    query(options: QueryOptions): QueryResult {
      return queryEntries(entries, options);
    },
    stats(): StatsResult {
      return buildStats(entries);
    },
    clear(): void {
      entries = [];
    },
    getSources(): string[] {
      return [
        ...new Set(entries.map((entry: LogEntry): string => entry.source ?? '').filter(Boolean)),
      ].sort();
    },
  };
}

function parseWinstonLine(line: string): Omit<LogEntry, 'id'> | null {
  const trimmed: string = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsedUnknown: unknown = JSON.parse(trimmed);
    if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
      return null;
    }
    const parsed: Record<string, unknown> = parsedUnknown as Record<string, unknown>;
    const level: LogLevel = normalizeLevel(String(parsed.level ?? 'info'));
    const timestampRaw: unknown = parsed.timestamp;
    const { timestamp, timestampMeta } = ((): {
      timestamp: string;
      timestampMeta: undefined | Record<string, unknown>;
    } => {
      const nowIso: string = new Date().toISOString();

      if (timestampRaw === undefined || timestampRaw === null || timestampRaw === '') {
        return {
          timestamp: nowIso,
          timestampMeta: undefined as undefined | Record<string, unknown>,
        };
      }

      // Numbers (or numeric strings) can be epoch seconds or ms.
      if (
        typeof timestampRaw === 'number' ||
        (typeof timestampRaw === 'string' && /^\d+(\.\d+)?$/.test(timestampRaw.trim()))
      ) {
        const rawNum: number =
          typeof timestampRaw === 'number' ? timestampRaw : Number(timestampRaw);
        if (Number.isFinite(rawNum)) {
          const msGuess: number = rawNum < 1e12 ? rawNum * 1000 : rawNum;
          const date = new Date(msGuess);
          if (!Number.isNaN(date.getTime())) {
            return {
              timestamp: date.toISOString(),
              timestampMeta: undefined as undefined | Record<string, unknown>,
            };
          }
        }
      }

      const rawStr: string = String(timestampRaw).trim();
      if (!rawStr) {
        return {
          timestamp: nowIso,
          timestampMeta: undefined as undefined | Record<string, unknown>,
        };
      }

      // Most ISO-ish / RFC dates will be handled here.
      const directMs: number = Date.parse(rawStr);
      if (!Number.isNaN(directMs)) {
        return {
          timestamp: new Date(directMs).toISOString(),
          timestampMeta: undefined as undefined | Record<string, unknown>,
        };
      }

      // Common Winston timestamp format: "YYYY-MM-DD HH:mm:ss" (or with fractional seconds).
      // Convert to a parseable ISO-like string.
      const normalized: string = rawStr.replace(' ', 'T');
      const withTimezone: string = /Z$|[+-]\d{2}:\d{2}$/.test(normalized)
        ? normalized
        : `${normalized}Z`;
      const ms: number = Date.parse(withTimezone);
      if (!Number.isNaN(ms)) {
        return {
          timestamp: new Date(ms).toISOString(),
          timestampMeta: undefined as undefined | Record<string, unknown>,
        };
      }

      // Last resort: never break ingestion. Store raw timestamp for inspection.
      return {
        timestamp: nowIso,
        timestampMeta: { _timestampRaw: rawStr, _timestampParseFailed: true },
      };
    })();
    const message: string = String(parsed.message ?? '');
    const source: string | undefined = parsed.source ? String(parsed.source) : undefined;
    const explicitMeta: Record<string, unknown> | undefined =
      parsed.meta && typeof parsed.meta === 'object'
        ? (parsed.meta as Record<string, unknown>)
        : undefined;
    const metaBase: Record<string, unknown> =
      explicitMeta ??
      Object.fromEntries(
        Object.entries(parsed).filter(([key]: [string, unknown]): boolean => {
          return !['level', 'message', 'timestamp', 'source'].includes(key);
        })
      );
    const meta: Record<string, unknown> = timestampMeta
      ? { ...metaBase, ...timestampMeta }
      : metaBase;
    return { level, timestamp, message, source, meta };
  } catch (_error) {
    return null;
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped: string = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource: string = `^${escaped.replace(/\*/g, '.*')}$`;
  return new RegExp(regexSource, 'i');
}

function startOfUtcDayMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseFilenameDateMs(fileName: string): number | null {
  const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    return null;
  }
  const dateMs: number = Date.parse(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  return dateMs;
}

function resolveGlob(globPattern: string): { dir: string; fileNameRegex: RegExp } {
  const normalized: string = globPattern.replace(/\\/g, '/');
  const lastSlash: number = normalized.lastIndexOf('/');
  const dirPart: string = lastSlash === -1 ? '.' : normalized.slice(0, lastSlash);
  const filePart: string = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  const dir: string = path.resolve(dirPart);
  return { dir, fileNameRegex: globToRegex(filePart) };
}

function listMatchingFiles(globPattern: string): string[] {
  const { dir, fileNameRegex } = resolveGlob(globPattern);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const names: string[] = fs.readdirSync(dir);
  return names
    .filter((name: string): boolean => fileNameRegex.test(name))
    .map((name: string): string => path.join(dir, name));
}

function selectFilesByDays(globPattern: string, days: number): string[] {
  const all: string[] = listMatchingFiles(globPattern);
  const now: Date = new Date();
  const todayMs: number = startOfUtcDayMs(now);
  const effectiveDays: number = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 30;
  const cutoffMs: number = todayMs - (effectiveDays - 1) * 24 * 60 * 60 * 1000;

  const scored: Array<{ filePath: string; sortMs: number }> = [];
  for (const filePath of all) {
    const base: string = path.basename(filePath);
    const dateFromName: number | null = parseFilenameDateMs(base);
    let dayMs: number;
    let sortMs: number;
    if (dateFromName !== null) {
      dayMs = dateFromName;
      sortMs = dateFromName;
    } else {
      try {
        const stat: fs.Stats = fs.statSync(filePath);
        sortMs = stat.mtimeMs;
        dayMs = startOfUtcDayMs(new Date(stat.mtimeMs));
      } catch (_error) {
        continue;
      }
    }
    if (dayMs >= cutoffMs && dayMs <= todayMs) {
      scored.push({ filePath, sortMs });
    }
  }

  scored.sort((a, b) => a.sortMs - b.sortMs);
  return scored.map((item: { filePath: string }): string => item.filePath);
}

function loadEntriesFromFiles(filePaths: string[], maxEntries: number): LogEntry[] {
  const loaded: LogEntry[] = [];
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const raw: string = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const parsed: Omit<LogEntry, 'id'> | null = parseWinstonLine(line);
      if (!parsed) {
        continue;
      }
      loaded.push(sanitizeEntry(parsed));
    }
  }

  loaded.sort((a: LogEntry, b: LogEntry): number => {
    return Date.parse(b.timestamp) - Date.parse(a.timestamp);
  });
  if (loaded.length <= maxEntries) {
    return loaded;
  }
  return loaded.slice(0, maxEntries);
}

export function createGlobFileBackedLogStore(options: GlobFileStoreOptions): LogStore {
  let entries: LogEntry[] = [];
  let lastSignature: string = '';
  const liveTail: boolean = Boolean(options.liveTail);

  function computeSignature(files: string[]): string {
    let maxMtimeMs = 0;
    for (const filePath of files) {
      try {
        const stat: fs.Stats = fs.statSync(filePath);
        maxMtimeMs = Math.max(maxMtimeMs, stat.mtimeMs);
      } catch (_error) {
        // ignore
      }
    }
    return `${files.join('|')}::${maxMtimeMs}`;
  }

  function reload(force: boolean): void {
    const files: string[] = selectFilesByDays(options.fileGlob, options.days);
    const signature: string = computeSignature(files);
    if (!force && liveTail && signature === lastSignature) {
      return;
    }
    entries = loadEntriesFromFiles(files, options.maxEntries);
    lastSignature = signature;
  }

  reload(true);

  return {
    append(entry: Omit<LogEntry, 'id'>): LogEntry {
      const saved: LogEntry = sanitizeEntry(entry);
      entries.push(saved);
      entries = enforceLimit(entries, options.maxEntries);
      return saved;
    },
    query(optionsQuery: QueryOptions): QueryResult {
      reload(false);
      return queryEntries(entries, optionsQuery);
    },
    stats(): StatsResult {
      reload(false);
      return buildStats(entries);
    },
    clear(): void {
      entries = [];
      lastSignature = '';
    },
    getSources(): string[] {
      reload(false);
      return [
        ...new Set(entries.map((entry: LogEntry): string => entry.source ?? '').filter(Boolean)),
      ].sort();
    },
  };
}

export function createFileBackedLogStore(options: SingleFileStoreOptions): LogStore {
  let entries: LogEntry[] = [];
  let lastMtimeMs: number = 0;
  const resolvedPath: string = path.resolve(options.filePath);
  const liveTail: boolean = Boolean(options.liveTail);

  function ensureFileExists(): void {
    const dir: string = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(resolvedPath)) {
      fs.writeFileSync(resolvedPath, '');
    }
  }

  function reload(force: boolean): void {
    ensureFileExists();
    const stat: fs.Stats = fs.statSync(resolvedPath);
    if (!force && liveTail && stat.mtimeMs <= lastMtimeMs) {
      return;
    }
    const raw: string = fs.readFileSync(resolvedPath, 'utf8');
    const loaded: LogEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const parsed: Omit<LogEntry, 'id'> | null = parseWinstonLine(line);
      if (!parsed) {
        continue;
      }
      loaded.push(sanitizeEntry(parsed));
    }
    entries = enforceLimit(loaded, options.maxEntries);
    lastMtimeMs = stat.mtimeMs;
  }

  reload(true);

  return {
    append(entry: Omit<LogEntry, 'id'>): LogEntry {
      const saved: LogEntry = sanitizeEntry(entry);
      ensureFileExists();
      fs.appendFileSync(
        resolvedPath,
        `${JSON.stringify({
          timestamp: saved.timestamp,
          level: saved.level,
          message: saved.message,
          source: saved.source,
          meta: saved.meta ?? {},
        })}\n`
      );
      entries.push(saved);
      entries = enforceLimit(entries, options.maxEntries);
      lastMtimeMs = fs.statSync(resolvedPath).mtimeMs;
      return saved;
    },
    query(optionsQuery: QueryOptions): QueryResult {
      reload(false);
      return queryEntries(entries, optionsQuery);
    },
    stats(): StatsResult {
      reload(false);
      return buildStats(entries);
    },
    clear(): void {
      ensureFileExists();
      fs.writeFileSync(resolvedPath, '');
      entries = [];
      lastMtimeMs = fs.statSync(resolvedPath).mtimeMs;
    },
    getSources(): string[] {
      reload(false);
      return [
        ...new Set(entries.map((entry: LogEntry): string => entry.source ?? '').filter(Boolean)),
      ].sort();
    },
  };
}

export function createLogStore(options: CreateLogStoreOptions): LogStore {
  const mode: StorageMode = options.mode ?? 'memory';
  if (mode === 'file') {
    const fileOptions = options as Extract<CreateLogStoreOptions, { mode: 'file' }>;
    if ('fileGlob' in fileOptions) {
      return createGlobFileBackedLogStore({
        fileGlob: fileOptions.fileGlob,
        days: fileOptions.days,
        maxEntries: fileOptions.maxEntries,
        liveTail: fileOptions.liveTail,
      });
    }
    return createFileBackedLogStore({
      filePath: fileOptions.filePath,
      maxEntries: fileOptions.maxEntries,
      liveTail: fileOptions.liveTail,
    });
  }

  const memoryOptions = options as Extract<CreateLogStoreOptions, { mode?: 'memory' }>;
  return createInMemoryLogStore(memoryOptions.maxEntries);
}

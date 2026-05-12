import { Router, Request, Response } from 'express';
import { LogStore, QueryOptions } from '../store/logStore';

function parseNumber(value: unknown, fallback: number): number {
  const parsed: number = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function formatCsvValue(value: string): string {
  const escaped: string = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildQueryOptions(query: Request['query']): QueryOptions {
  return {
    level: query.level ? String(query.level) : undefined,
    source: query.source ? String(query.source) : undefined,
    search: query.search ? String(query.search) : undefined,
    startDate: query.startDate ? String(query.startDate) : undefined,
    endDate: query.endDate ? String(query.endDate) : undefined,
    limit: query.limit ? parseNumber(query.limit, 25) : 25,
    offset: query.offset ? parseNumber(query.offset, 0) : 0,
  };
}

export function createLogRoutes(store: LogStore): Router {
  const router: Router = Router();

  router.get('/', (req: Request, res: Response): void => {
    const options: QueryOptions = buildQueryOptions(req.query);
    const result = store.query(options);
    const page: number = Math.floor((options.offset ?? 0) / (options.limit ?? 25)) + 1;
    res.json({ data: result.data, total: result.total, page });
  });

  router.get('/stats', (_req: Request, res: Response): void => {
    const stats = store.stats();
    res.json({
      data: stats,
      total: stats.total,
      page: 1,
      sources: store.getSources(),
    });
  });

  router.get('/export/csv', (req: Request, res: Response): void => {
    const options: QueryOptions = buildQueryOptions(req.query);
    const result = store.query(options);
    const rows: string[] = result.data.map(entry => {
      return [
        formatCsvValue(entry.id),
        formatCsvValue(entry.timestamp),
        formatCsvValue(entry.level),
        formatCsvValue(entry.source ?? ''),
        formatCsvValue(entry.message),
        formatCsvValue(JSON.stringify(entry.meta ?? {})),
      ].join(',');
    });
    const csv: string = ['id,timestamp,level,source,message,meta', ...rows].join('\n');
    const dateStamp: string = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="logs-${dateStamp}.csv"`);
    res.send(csv);
  });

  return router;
}

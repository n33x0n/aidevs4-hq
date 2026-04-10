import type { APIRoute } from 'astro';
import { listDatabases, listTables, getTableSchema, getTableRows, executeQuery } from '../../lib/db-browser';

export const GET: APIRoute = async ({ url }) => {
  const action = url.searchParams.get('action') ?? 'databases';
  const dbName = url.searchParams.get('db') ?? 'agent';
  const table = url.searchParams.get('table') ?? '';

  try {
    let data: unknown;

    switch (action) {
      case 'databases':
        data = listDatabases();
        break;
      case 'tables':
        data = listTables(dbName);
        break;
      case 'schema':
        if (!table) return jsonError('Missing "table" parameter', 400);
        data = getTableSchema(dbName, table);
        break;
      case 'rows':
        if (!table) return jsonError('Missing "table" parameter', 400);
        data = getTableRows(dbName, table, {
          page: parseInt(url.searchParams.get('page') ?? '1'),
          limit: parseInt(url.searchParams.get('limit') ?? '50'),
          orderBy: url.searchParams.get('orderBy') ?? undefined,
          orderDir: url.searchParams.get('orderDir') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
        });
        break;
      default:
        return jsonError(`Unknown action: ${action}`, 400);
    }

    return jsonOk(data);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { db: dbName = 'agent', sql } = body as { db?: string; sql?: string };

    if (!sql || typeof sql !== 'string') {
      return jsonError('Missing "sql" field in request body', 400);
    }

    const result = executeQuery(dbName, sql.trim());

    if (result.error) {
      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
};

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

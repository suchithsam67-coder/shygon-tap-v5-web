// The PostgREST subset that SHYGON uses, for the local stack (V6, D-4).
//
// Every request becomes real SQL, run in its own transaction on the local
// database under the caller's role (`anon`, `authenticated` or
// `service_role`) with the same request settings PostgREST sets
// (request.jwt.claims, request.jwt.claim.sub, request.headers). Row-level
// security, grants, triggers, constraints and SECURITY DEFINER functions are
// therefore Postgres's own, not emulated. What is emulated is only the HTTP
// translation, and only the parts the app and the server functions use:
//
//   GET/HEAD   /rest/v1/<table>?select=..&<col>=<op>.<value>&order=..&limit=..&offset=..
//   POST       /rest/v1/<table>            insert / upsert (on_conflict, resolution)
//   PATCH      /rest/v1/<table>?<filters>  update
//   DELETE     /rest/v1/<table>?<filters>  delete
//   POST/GET   /rest/v1/rpc/<function>     named arguments
//
// Anything outside that subset (embedded resources, or=/and=, JSON paths) is
// refused with a 400 that says so, rather than answered approximately.

export class RestError extends Error {
  constructor(status, body) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = { code: null, details: null, hint: null, ...body };
  }
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;
const unsupported = (what) =>
  new RestError(400, { code: 'PGRST100', message: `${what} is not supported by the local gateway` });

/** Postgres SQLSTATE to HTTP status, as PostgREST maps it. */
export function httpStatusFor(code, authenticated) {
  if (!code) return 500;
  if (code === '42501') return authenticated ? 403 : 401;
  if (code === '23503' || code === '23505') return 409;
  if (code === 'P0001') return 400;
  if (code === '42883' || code === '42P01') return 404;
  if (code === '25006') return 405;
  if (code.startsWith('08') || code.startsWith('53')) return 503;
  if (code.startsWith('54')) return 413;
  if (code.startsWith('0L') || code.startsWith('0P') || code.startsWith('28')) return 403;
  if (/^(09|25|2D|38|39|3B|40|55|57|58|F0|HV|XX|P0)/.test(code)) return 500;
  return 400;
}

/** Tables, columns, primary keys and functions of the `public` schema. */
export async function loadSchema(db) {
  const tables = new Map();
  const columns = await db.query(`
    SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`);
  for (const { tbl, col, type } of columns.rows) {
    if (!tables.has(tbl)) tables.set(tbl, { columns: new Map(), primaryKey: [] });
    tables.get(tbl).columns.set(col, type);
  }
  const keys = await db.query(`
    SELECT c.relname AS tbl, a.attname AS col
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE i.indisprimary AND n.nspname = 'public'
    ORDER BY c.relname, k.ord`);
  for (const { tbl, col } of keys.rows) tables.get(tbl)?.primaryKey.push(col);

  const functions = new Map();
  const procs = await db.query(`
    SELECT p.proname AS name, p.pronargs AS nargs, p.pronargdefaults AS ndefaults,
           p.proretset AS retset, p.proargnames AS argnames, p.proargmodes::text[] AS argmodes,
           ARRAY(SELECT format_type(t, NULL)
                 FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS u(t, o) ORDER BY o) AS argtypes,
           format_type(p.prorettype, NULL) AS rettype, rt.typtype AS rettyptype
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type rt ON rt.oid = p.prorettype
    WHERE n.nspname = 'public' AND p.prokind = 'f'`);
  for (const row of procs.rows) {
    const modes = row.argmodes;
    const names = row.argnames ?? [];
    const inputNames = modes
      ? names.filter((_, i) => ['i', 'b', 'v'].includes(modes[i]))
      : names.slice(0, row.nargs);
    const inputs = row.argtypes.map((type, i) => ({ name: inputNames[i] ?? null, type }));
    const rowShaped = row.rettyptype === 'c' || row.rettype === 'record';
    const overload = {
      inputs,
      required: row.nargs - row.ndefaults,
      returns: row.rettype === 'void' ? 'void' : row.retset ? (rowShaped ? 'rows' : 'scalars') : rowShaped ? 'row' : 'scalar',
    };
    if (!functions.has(row.name)) functions.set(row.name, []);
    functions.get(row.name).push(overload);
  }
  return { tables, functions };
}

function parsePrefer(headers) {
  const prefer = {};
  for (const token of String(headers.prefer ?? '').split(',')) {
    const [key, value] = token.trim().split('=');
    if (key) prefer[key] = value;
  }
  return prefer;
}

const wantsObject = (headers) => /application\/vnd\.pgrst\.object\+json/.test(String(headers.accept ?? ''));

/** `(a,b,"c,d")` → ['a', 'b', 'c,d'] */
function parseList(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  if (!inner) return [];
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quoted && ch === '\\' && i + 1 < inner.length) {
      current += inner[++i];
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

class Sql {
  constructor() {
    this.params = [];
  }
  /** A text parameter cast to `type`, so Postgres (not a JS serialiser) parses it. */
  value(value, type) {
    if (value === null || value === undefined) return `NULL::${type}`;
    this.params.push(String(value));
    return `$${this.params.length}::text::${type}`;
  }
}

function tableOf(schema, name) {
  const table = schema.tables.get(name);
  if (!table) {
    throw new RestError(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` });
  }
  return table;
}

function columnType(table, tableName, column) {
  const type = table.columns.get(column);
  if (!type) throw new RestError(400, { code: '42703', message: `column ${tableName}.${column} does not exist` });
  return type;
}

function selectList(table, tableName, select) {
  const raw = select === undefined || select === null || select === '' ? '*' : select;
  if (/[()]/.test(raw)) throw unsupported('An embedded resource in select');
  const items = [];
  for (const part of raw.split(',')) {
    if (part === '*') {
      for (const col of table.columns.keys()) items.push(`pgrst_t.${quote(col)} AS ${quote(col)}`);
      continue;
    }
    if (/->/.test(part)) throw unsupported('A JSON path in select');
    const match = part.match(/^(?:([A-Za-z_][A-Za-z0-9_]*):)?([A-Za-z_][A-Za-z0-9_]*)(?:::([A-Za-z_][A-Za-z0-9_ ]*))?$/);
    if (!match) throw new RestError(400, { code: 'PGRST100', message: `"${part}" is not a column in the local gateway's select syntax` });
    const [, alias, column, cast] = match;
    columnType(table, tableName, column);
    items.push(`pgrst_t.${quote(column)}${cast ? `::${cast}` : ''} AS ${quote(alias ?? column)}`);
  }
  return items.join(', ');
}

const OPERATORS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', cs: '@>', cd: '<@', ov: '&&' };

function condition(sql, table, tableName, column, raw) {
  const type = columnType(table, tableName, column);
  const target = `pgrst_t.${quote(column)}`;
  let expression = raw;
  let negate = false;
  if (expression.startsWith('not.')) {
    negate = true;
    expression = expression.slice(4);
  }
  const dot = expression.indexOf('.');
  if (dot < 0) throw new RestError(400, { code: 'PGRST100', message: `"${raw}" is not a filter` });
  const op = expression.slice(0, dot);
  const value = expression.slice(dot + 1);
  let clause;
  if (op in OPERATORS) {
    clause = `${target} ${OPERATORS[op]} ${sql.value(value, type)}`;
  } else if (op === 'like' || op === 'ilike') {
    clause = `${target} ${op === 'like' ? 'LIKE' : 'ILIKE'} ${sql.value(value.replace(/\*/g, '%'), 'text')}`;
  } else if (op === 'is') {
    const literal = { null: 'NULL', true: 'TRUE', false: 'FALSE', unknown: 'UNKNOWN' }[value.toLowerCase()];
    if (!literal) throw new RestError(400, { code: 'PGRST100', message: `"is.${value}" is not a filter` });
    clause = `${target} IS ${literal}`;
  } else if (op === 'in') {
    const values = parseList(value);
    clause = values.length === 0 ? 'FALSE' : `${target} IN (${values.map((v) => sql.value(v, type)).join(', ')})`;
  } else {
    throw unsupported(`The "${op}" filter`);
  }
  return negate ? `NOT (${clause})` : clause;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function whereClause(sql, table, tableName, searchParams) {
  const clauses = [];
  for (const [key, value] of searchParams) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and' || key.startsWith('not.or') || key.startsWith('not.and')) {
      throw unsupported('A logical (or/and) filter');
    }
    clauses.push(condition(sql, table, tableName, key, value));
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

function orderClause(table, tableName, order) {
  if (!order) return '';
  const terms = order.split(',').map((term) => {
    const [column, ...flags] = term.split('.');
    columnType(table, tableName, column);
    let sqlTerm = `pgrst_t.${quote(column)}`;
    if (flags.includes('desc')) sqlTerm += ' DESC';
    if (flags.includes('nullsfirst')) sqlTerm += ' NULLS FIRST';
    if (flags.includes('nullslast')) sqlTerm += ' NULLS LAST';
    return sqlTerm;
  });
  return ` ORDER BY ${terms.join(', ')}`;
}

function intParam(searchParams, name) {
  const raw = searchParams.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new RestError(400, { code: 'PGRST100', message: `"${name}" must be a non-negative integer` });
  return n;
}

/** Shapes rows into PostgREST's response, honouring single-object requests. */
function respond(headers, rowsJson, count, { status, total, method }) {
  const rows = JSON.parse(rowsJson);
  const responseHeaders = { 'content-type': 'application/json; charset=utf-8' };
  if (total !== undefined) {
    responseHeaders['content-range'] = count === 0 ? `*/${total ?? '*'}` : `0-${count - 1}/${total ?? '*'}`;
  }
  if (wantsObject(headers)) {
    if (rows.length !== 1) {
      throw new RestError(406, {
        code: 'PGRST116',
        details: `The result contains ${rows.length} rows`,
        message: 'JSON object requested, multiple (or no) rows returned',
      });
    }
    responseHeaders['content-type'] = 'application/vnd.pgrst.object+json; charset=utf-8';
    return { status, headers: responseHeaders, body: method === 'HEAD' ? '' : JSON.stringify(rows[0]) };
  }
  return { status, headers: responseHeaders, body: method === 'HEAD' ? '' : rowsJson };
}

/** Rows written by `statement` (INSERT/UPDATE/DELETE), shaped by `selected`. */
async function readMutation(tx, sql, statement, selected) {
  const result = await tx.query(
    `WITH pgrst_w AS (${statement} RETURNING pgrst_t.*), pgrst_s AS (SELECT ${selected} FROM pgrst_w AS pgrst_t) ` +
      `SELECT coalesce(json_agg(pgrst_r), '[]'::json)::text AS body, count(*)::int AS n FROM pgrst_s AS pgrst_r`,
    sql.params,
  );
  return { body: result.rows[0].body, n: result.rows[0].n };
}

async function readRows(tx, sql, statement) {
  const result = await tx.query(
    `SELECT coalesce(json_agg(pgrst_r), '[]'::json)::text AS body, count(*)::int AS n FROM (${statement}) pgrst_r`,
    sql.params,
  );
  return { body: result.rows[0].body, n: result.rows[0].n };
}

async function handleRead(tx, schema, tableName, url, headers, method) {
  const table = tableOf(schema, tableName);
  const sql = new Sql();
  const where = whereClause(sql, table, tableName, url.searchParams);
  const columns = selectList(table, tableName, url.searchParams.get('select'));
  const limit = intParam(url.searchParams, 'limit');
  const offset = intParam(url.searchParams, 'offset');
  const statement =
    `SELECT ${columns} FROM public.${quote(tableName)} AS pgrst_t${where}` +
    orderClause(table, tableName, url.searchParams.get('order')) +
    (limit !== null ? ` LIMIT ${limit}` : '') +
    (offset !== null ? ` OFFSET ${offset}` : '');
  const { body, n } = await readRows(tx, sql, statement);
  const prefer = parsePrefer(headers);
  let total;
  if (prefer.count) {
    const countSql = new Sql();
    const countWhere = whereClause(countSql, table, tableName, url.searchParams);
    const counted = await tx.query(`SELECT count(*)::int AS n FROM public.${quote(tableName)} AS pgrst_t${countWhere}`, countSql.params);
    total = counted.rows[0].n;
  } else if (method !== 'HEAD') {
    total = null;
  }
  return respond(headers, body, n, { status: 200, total, method });
}

function payloadColumns(table, tableName, url, payload) {
  const listed = url.searchParams.get('columns');
  const names = listed
    ? listed.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    : [...new Set((Array.isArray(payload) ? payload : [payload]).flatMap((row) => Object.keys(row ?? {})))];
  for (const name of names) {
    if (!table.columns.has(name)) {
      throw new RestError(400, { code: 'PGRST204', message: `Could not find the '${name}' column of '${tableName}' in the schema cache` });
    }
  }
  return names;
}

function returning(table, tableName, url, prefer) {
  if (prefer.return !== 'representation') return null;
  return selectList(table, tableName, url.searchParams.get('select'));
}

async function handleInsert(tx, schema, tableName, url, headers, payload) {
  const table = tableOf(schema, tableName);
  if (payload === null || typeof payload !== 'object') {
    throw new RestError(400, { code: 'PGRST102', message: 'Empty or invalid json' });
  }
  const prefer = parsePrefer(headers);
  const columns = payloadColumns(table, tableName, url, payload);
  const sql = new Sql();
  const rows = Array.isArray(payload) ? payload : [payload];
  let statement;
  if (columns.length === 0) {
    if (rows.length !== 1) throw unsupported('Inserting several rows with no columns');
    statement = `INSERT INTO public.${quote(tableName)} AS pgrst_t DEFAULT VALUES`;
  } else {
    const list = columns.map(quote).join(', ');
    statement =
      `INSERT INTO public.${quote(tableName)} AS pgrst_t (${list}) ` +
      `SELECT ${list} FROM json_populate_recordset(NULL::public.${quote(tableName)}, ${sql.value(JSON.stringify(rows), 'json')})`;
  }
  if (prefer.resolution) {
    const target = url.searchParams.get('on_conflict')?.split(',').map((c) => c.trim()) ?? table.primaryKey;
    if (target.length === 0) throw unsupported('An upsert on a table without a primary key');
    const updates = columns.map((c) => `${quote(c)} = EXCLUDED.${quote(c)}`);
    statement +=
      ` ON CONFLICT (${target.map(quote).join(', ')})` +
      (prefer.resolution === 'ignore-duplicates' || updates.length === 0 ? ' DO NOTHING' : ` DO UPDATE SET ${updates.join(', ')}`);
  }
  const selected = returning(table, tableName, url, prefer);
  if (!selected) {
    await tx.query(statement, sql.params);
    if (wantsObject(headers)) throw unsupported('A single-object response without return=representation');
    return { status: 201, headers: {}, body: '' };
  }
  const { body, n } = await readMutation(tx, sql, statement, selected);
  return respond(headers, body, n, { status: 201 });
}

async function handleUpdate(tx, schema, tableName, url, headers, payload) {
  const table = tableOf(schema, tableName);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RestError(400, { code: 'PGRST102', message: 'Empty or invalid json' });
  }
  const prefer = parsePrefer(headers);
  const columns = payloadColumns(table, tableName, url, payload);
  const sql = new Sql();
  const source = sql.value(JSON.stringify(payload), 'json');
  const where = whereClause(sql, table, tableName, url.searchParams);
  if (columns.length === 0) return { status: 204, headers: {}, body: '' };
  const statement =
    `UPDATE public.${quote(tableName)} AS pgrst_t SET ` +
    columns.map((c) => `${quote(c)} = pgrst_p.${quote(c)}`).join(', ') +
    ` FROM json_populate_record(NULL::public.${quote(tableName)}, ${source}) AS pgrst_p${where}`;
  const selected = returning(table, tableName, url, prefer);
  if (!selected) {
    await tx.query(statement, sql.params);
    return { status: 204, headers: {}, body: '' };
  }
  const { body, n } = await readMutation(tx, sql, statement, selected);
  return respond(headers, body, n, { status: 200 });
}

async function handleDelete(tx, schema, tableName, url, headers) {
  const table = tableOf(schema, tableName);
  const prefer = parsePrefer(headers);
  const sql = new Sql();
  const where = whereClause(sql, table, tableName, url.searchParams);
  const statement = `DELETE FROM public.${quote(tableName)} AS pgrst_t${where}`;
  const selected = returning(table, tableName, url, prefer);
  if (!selected) {
    await tx.query(statement, sql.params);
    return { status: 204, headers: {}, body: '' };
  }
  const { body, n } = await readMutation(tx, sql, statement, selected);
  return respond(headers, body, n, { status: 200 });
}

function argument(sql, type, value) {
  if (value === null || value === undefined) return `NULL::${type}`;
  if (type === 'json' || type === 'jsonb') return sql.value(JSON.stringify(value), type);
  if (type.endsWith('[]') && Array.isArray(value)) {
    sql.params.push(JSON.stringify(value));
    return `ARRAY(SELECT jsonb_array_elements_text($${sql.params.length}::text::jsonb))::${type}`;
  }
  if (typeof value === 'object') return sql.value(JSON.stringify(value), type);
  return sql.value(value, type);
}

async function handleRpc(tx, schema, name, args) {
  const overloads = schema.functions.get(name) ?? [];
  const given = Object.keys(args);
  const overload = overloads.find((candidate) => {
    const names = candidate.inputs.map((input) => input.name);
    return (
      given.every((key) => names.includes(key)) &&
      candidate.inputs.slice(0, candidate.required).every((input) => given.includes(input.name))
    );
  });
  if (!overload) {
    throw new RestError(404, {
      code: 'PGRST202',
      message: `Could not find the function public.${name}(${given.join(', ')}) in the schema cache`,
    });
  }
  const sql = new Sql();
  const call =
    `public.${quote(name)}(` +
    overload.inputs
      .filter((input) => given.includes(input.name))
      .map((input) => `${quote(input.name)} := ${argument(sql, input.type, args[input.name])}`)
      .join(', ') +
    ')';
  const json = { 'content-type': 'application/json; charset=utf-8' };
  switch (overload.returns) {
    case 'void':
      await tx.query(`SELECT ${call}`, sql.params);
      return { status: 204, headers: {}, body: '' };
    case 'rows': {
      const result = await tx.query(`SELECT coalesce(json_agg(pgrst_r), '[]'::json)::text AS body FROM ${call} AS pgrst_r`, sql.params);
      return { status: 200, headers: json, body: result.rows[0].body };
    }
    case 'scalars': {
      const result = await tx.query(`SELECT coalesce(json_agg(pgrst_r.v), '[]'::json)::text AS body FROM ${call} AS pgrst_r(v)`, sql.params);
      return { status: 200, headers: json, body: result.rows[0].body };
    }
    case 'row': {
      const result = await tx.query(`SELECT row_to_json(pgrst_r)::text AS body FROM ${call} AS pgrst_r`, sql.params);
      return { status: 200, headers: json, body: result.rows[0]?.body ?? 'null' };
    }
    default: {
      const result = await tx.query(`SELECT to_json(${call})::text AS body`, sql.params);
      return { status: 200, headers: json, body: result.rows[0].body ?? 'null' };
    }
  }
}

/**
 * Handles one /rest/v1 request inside `tx` (already scoped to the caller).
 * `path` is what follows /rest/v1/.
 */
export async function handleRest(tx, schema, { method, path, url, headers, body }) {
  const parseBody = () => {
    if (body === undefined || body === null || body === '') return null;
    try {
      return JSON.parse(body);
    } catch {
      throw new RestError(400, { code: 'PGRST102', message: 'Empty or invalid json' });
    }
  };
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'rpc' && segments.length === 2) {
    let args;
    if (method === 'GET' || method === 'HEAD') args = Object.fromEntries(url.searchParams);
    else if (method === 'POST') args = parseBody() ?? {};
    else throw new RestError(405, { code: 'PGRST117', message: `Unsupported HTTP method: ${method}` });
    if (typeof args !== 'object' || Array.isArray(args)) throw unsupported('A non-object RPC body');
    return handleRpc(tx, schema, segments[1], args);
  }
  if (segments.length !== 1) throw new RestError(404, { code: 'PGRST125', message: `Invalid path: ${path}` });
  const tableName = segments[0];
  switch (method) {
    case 'GET':
    case 'HEAD':
      return handleRead(tx, schema, tableName, url, headers, method);
    case 'POST':
      return handleInsert(tx, schema, tableName, url, headers, parseBody());
    case 'PATCH':
      return handleUpdate(tx, schema, tableName, url, headers, parseBody());
    case 'DELETE':
      return handleDelete(tx, schema, tableName, url, headers);
    default:
      throw new RestError(405, { code: 'PGRST117', message: `Unsupported HTTP method: ${method}` });
  }
}

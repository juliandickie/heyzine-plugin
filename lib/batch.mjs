import { publishOne, preflightExisting } from './publish.mjs';
import { HeyzineError } from './client.mjs';
import { toCsv } from './csv.mjs';
import { shortId, publicUrl } from './links.mjs';

const TRUE = /^(true|1|yes|y)$/i;
const FALSE = /^(false|0|no|n)$/i;
const DESIGN_COLUMNS = ['download', 'full_screen', 'share', 'prev_next', 'show_info', 'rtl'];

// An unrecognised cell is a typo, not a false. Throwing inside rowToSpec fails that one row
// (the worker try/catch records it) instead of silently publishing with the wrong design.
export function coerceBool(value, column) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim();
  if (s === '') return undefined;
  if (TRUE.test(s)) return true;
  if (FALSE.test(s)) return false;
  throw new HeyzineError('validation', `column ${column} has an unrecognised boolean value "${value}"`);
}

export function rowToSpec(row) {
  const design = {};
  for (const col of DESIGN_COLUMNS) { const b = coerceBool(row[col], col); if (b !== undefined) design[col] = b; }
  for (const col of ['page_effect', 'background_color', 'logo', 'subtitle']) if (row[col]) design[col] = row[col];
  return {
    source: row.source, name: row.name, purpose: row.purpose || 'other', course: row.course || undefined, iddTo: row.idd_to || undefined,
    template: row.template || undefined, urlPath: row.url_path || undefined, urlDomain: row.url_domain || undefined,
    replace: coerceBool(row.replace, 'replace') === true, tags: row.tags || undefined, note: row.note || undefined, description: row.description || undefined,
    embedded: row.embedded || undefined, design,
  };
}

export const RESULT_COLUMNS = ['row', 'name', 'status', 'id', 'short', 'url', 'base', 'pages', 'register', 'error'];

export async function runBatch(ctx, rows, { concurrency = 2, cache = null, publish = publishOne, onRow = () => {} } = {}) {
  const results = new Array(rows.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next; next += 1;
      if (index >= rows.length) return;
      const row = rows[index];
      let result;
      try {
        const spec = rowToSpec(row);
        const existing = spec.replace ? null : preflightExisting(spec, cache);
        if (existing) {
          result = { row: index + 1, name: spec.name, status: 'skipped-existing', id: existing.id, short: shortId(existing.id), url: publicUrl(existing, ctx.settings?.publicHost ?? ''), base: existing.links?.base ?? '', pages: existing.pages ?? '', register: '', error: '' };
        } else {
          const r = await publish(ctx, spec);
          result = { row: index + 1, name: spec.name, status: spec.replace ? 'replaced' : 'converted', id: r.id, short: r.short, url: r.url, base: r.base, pages: r.pages ?? '', register: r.register_settled ? 'settled' : 'pending', error: '' };
        }
      } catch (error) {
        result = { row: index + 1, name: row?.name ?? '', status: 'failed', id: '', short: '', url: '', base: '', pages: '', register: '', error: `${error.code ?? 'error'}: ${error.message}` };
      }
      results[index] = result;
      // A reporter that throws must not take the batch down with it.
      try { onRow(result); } catch { /* the row is already recorded */ }
    }
  }
  const workers = Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 2;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, rows.length || 1)) }, worker));
  const summary = { total: rows.length, converted: 0, replaced: 0, skipped: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'converted') summary.converted += 1;
    else if (r.status === 'replaced') summary.replaced += 1;
    else if (r.status === 'skipped-existing') summary.skipped += 1;
    else summary.failed += 1;
  }
  return { results, summary };
}

export function resultsCsv(results) { return toCsv(results, RESULT_COLUMNS); }

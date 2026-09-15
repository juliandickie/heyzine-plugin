import path from 'node:path';
import { shortId, publicUrl, isFullFlipbookId, isFullBookshelfId, parseId } from './links.mjs';
import { parseNote, tagFacets } from './register.mjs';
import { parseCsv } from './csv.mjs';

export function inventoryPath(dir) { return path.join(dir, 'inventory.json'); }

export function normaliseTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s*[-|]\s*(by\s+)?idd\s*$/g, ' ')
    .replace(/\bby idd\b/g, ' ')
    .replace(/\b(review\s+pdf|pdf\s+review)\b/g, 'review')
    .replace(/\(?\bpdf\b\)?/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s) => new Set(normaliseTitle(s).split(' ').filter(Boolean));

export function overlap(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function matchTitle(name, items) {
  const n = normaliseTitle(name);
  if (!n) return { tier: 'none', matches: [] };
  const exact = items.filter((i) => normaliseTitle(i.title) === n);
  if (exact.length) return { tier: 'exact', matches: exact.map((item) => ({ item, score: 1 })) };
  const fuzzy = items.map((item) => ({ item, score: overlap(name, item.title) })).filter((m) => m.score >= 0.8).sort((x, y) => y.score - x.score);
  if (fuzzy.length) return { tier: 'fuzzy', matches: fuzzy };
  if (n.length >= 12) {
    const sub = items.filter((i) => { const t = normaliseTitle(i.title); return t.includes(n) || n.includes(t); });
    if (sub.length) return { tier: 'substring', matches: sub.map((item) => ({ item, score: 0.5 })) };
  }
  return { tier: 'none', matches: [] };
}

export function parseNamesFile(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const header = lines.findIndex((l) => /^\s*\|/.test(l) && /name/i.test(l));
  if (header !== -1) {
    const cols = lines[header].split('|').map((c) => c.trim().toLowerCase());
    let idx = cols.findIndex((c) => c === 'anchor name');
    if (idx === -1) idx = cols.findIndex((c) => c.includes('name'));
    return lines.slice(header + 1)
      .filter((l) => /^\s*\|/.test(l) && !/^\s*\|\s*-{2,}/.test(l))
      .map((l) => (l.split('|')[idx] ?? '').trim())
      .filter(Boolean);
  }
  const first = lines.find((l) => l.trim() !== '') ?? '';
  if (/,/.test(first) && /(^|,)\s*name\s*(,|$)/i.test(first)) {
    return parseCsv(String(text)).map((r) => r.name).filter(Boolean);
  }
  return lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function decorate(item) {
  const register = parseNote(item.private ?? '');
  const { facets } = tagFacets(item.tags ?? '');
  return { ...item, register, facets };
}

export async function refreshInventory(client, { writeFile, now = () => new Date(), onProgress = () => {} } = {}) {
  const list = await client.listFlipbooks();
  const items = [];
  for (const [index, entry] of list.entries()) {
    const details = await client.flipbookDetails(entry.id);
    items.push(decorate({ ...entry, tags: details.tags ?? '', private: details.private ?? entry.private ?? '', links: details.links ?? entry.links, pages: details.pages ?? entry.pages, oembed: details.oembed ?? null }));
    onProgress(index + 1, list.length);
  }
  let bookshelves = [];
  let bookshelvesError = null;
  try { bookshelves = await client.listBookshelves(); } catch (error) { bookshelvesError = `${error.code ?? 'error'}: ${error.message}`; }
  const cache = { fetched_at: now().toISOString(), count: items.length, items, bookshelves, bookshelves_error: bookshelvesError };
  await writeFile(JSON.stringify(cache, null, 2));
  return cache;
}

export async function loadInventory({ dir, readFile }) {
  try {
    return JSON.parse(await readFile(inventoryPath(dir), 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export function resolveFullId(input, cache) {
  const s = String(input ?? '').trim();
  if (isFullFlipbookId(s)) return { kind: 'flipbook', full: s.toLowerCase() };
  if (isFullBookshelfId(s)) return { kind: 'bookshelf', full: s.toLowerCase() };
  const parsed = parseId(s);
  const short = parsed.short;
  const items = cache?.items ?? [];
  const shelves = cache?.bookshelves ?? [];
  if (short) {
    if (parsed.kind !== 'bookshelf') {
      const fb = items.find((i) => String(i.id).toLowerCase().startsWith(short));
      if (fb) return { kind: 'flipbook', full: fb.id };
    }
    const shelf = shelves.find((b) => String(b.id).toLowerCase().startsWith(short));
    if (shelf) return { kind: 'bookshelf', full: shelf.id };
  }
  if (parsed.slug) {
    const fb = items.find((i) => String(i.links?.custom ?? '').replace(/\/+$/, '').endsWith(`/${parsed.slug}`));
    if (fb) return { kind: 'flipbook', full: fb.id };
    const shelf = shelves.find((b) => String(b.links?.url ?? '').replace(/\/+$/, '').endsWith(`/${parsed.slug}`));
    if (shelf) return { kind: 'bookshelf', full: shelf.id };
  }
  return null;
}

export function reconcile(names, cache, { publicHost = '' } = {}) {
  const items = cache?.items ?? [];
  return names.map((name) => {
    const { tier, matches } = matchTitle(name, items);
    const candidates = matches.map(({ item, score }) => ({ id: item.id, short: shortId(item.id), title: item.title, url: publicUrl(item, publicHost), score, tier }));
    const status = matches.length === 0 ? 'missing' : matches.length === 1 ? 'exists' : 'ambiguous';
    const hit = status === 'exists' ? matches[0].item : null;
    return {
      name,
      status,
      id: hit ? hit.id : '',
      short: hit ? shortId(hit.id) : '',
      title: hit ? hit.title : '',
      url: hit ? publicUrl(hit, publicHost) : '',
      idd_to: hit ? (hit.register?.fields?.idd_to ?? hit.facets?.link?.[0] ?? '') : '',
      candidates,
    };
  });
}

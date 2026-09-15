const FULL_FLIPBOOK = /^[0-9a-f]{40}\.pdf$/i;
const FULL_SHELF = /^[0-9a-f]{40}$/i;
const SHORT = /^[0-9a-f]{10}$/i;

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

export function isFullFlipbookId(value) { return FULL_FLIPBOOK.test(String(value ?? '').trim()); }
export function isFullBookshelfId(value) { return FULL_SHELF.test(String(value ?? '').trim()); }

export function shortId(input) {
  const s = String(input ?? '').trim();
  if (FULL_FLIPBOOK.test(s) || FULL_SHELF.test(s)) return s.slice(0, 10).toLowerCase();
  if (SHORT.test(s)) return s.toLowerCase();
  const m = s.match(/\/(?:flip-book|shelf)\/([0-9a-f]{10})(?:\.html)?(?:[?#].*)?$/i)
    || s.match(/^https?:\/\/[^/]+\/([0-9a-f]{10})\.html(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function parseId(input) {
  const s = String(input ?? '').trim();
  if (FULL_FLIPBOOK.test(s)) return { kind: 'flipbook', full: s.toLowerCase(), short: s.slice(0, 10).toLowerCase(), slug: null };
  if (FULL_SHELF.test(s)) return { kind: 'bookshelf', full: s.toLowerCase(), short: s.slice(0, 10).toLowerCase(), slug: null };
  const short = shortId(s);
  let kind = 'unknown';
  if (/\/shelf\//i.test(s)) kind = 'bookshelf';
  else if (/\/flip-book\//i.test(s) || /\.html(?:[?#].*)?$/i.test(s)) kind = 'flipbook';
  let slug = null;
  if (!short && /^https?:\/\//i.test(s)) {
    const m = s.match(/^https?:\/\/[^/]+\/(?:shelf\/|flip-book\/)?([^/?#]+?)(?:\.html)?(?:[?#].*)?$/i);
    if (m) slug = m[1];
  }
  return { kind, full: null, short, slug };
}

export function publicUrl(flipbook, publicHost) {
  const base = flipbook?.links?.custom || flipbook?.links?.base || flipbook?.url || null;
  if (!has(publicHost)) return base;
  const short = shortId(base) || shortId(flipbook?.id);
  if (!short) return base;
  const host = String(publicHost).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${host}/${short}.html`;
}

export function driveFileId(input) {
  const s = String(input ?? '').trim();
  const m = s.match(/\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

export const DRIVE_URL_FORMS = ['usercontent', 'uc'];

export function driveDirectUrl(input, { form = 'usercontent' } = {}) {
  const id = driveFileId(input);
  if (!id) throw new Error(`Not a Google Drive file id or link: ${input}`);
  if (form === 'uc') return `https://drive.google.com/uc?export=download&id=${id}`;
  if (form === 'usercontent') return `https://drive.usercontent.google.com/download?id=${id}&export=download`;
  throw new Error(`Unknown Drive URL form: ${form}`);
}

const LINK_PARAMS = {
  template: 'tpl', title: 't', subtitle: 's', description: 'ds', download: 'd', full_screen: 'fs',
  share: 'sh', prev_next: 'pn', show_info: 'st', background_color: 'bg', logo: 'lg', page_effect: 'pe', rtl: 'rtl',
};

export function linkConversionUrl(pdfUrl, clientId, options = {}) {
  if (!has(pdfUrl)) throw new Error('pdfUrl is required');
  if (!has(clientId)) throw new Error('clientId is required (client_id in the config file, see heyzine.com/developers#apikey)');
  const params = new URLSearchParams({ pdf: pdfUrl, k: clientId });
  for (const [name, short] of Object.entries(LINK_PARAMS)) {
    const value = options[name];
    if (value === undefined || value === null || value === '') continue;
    params.set(short, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return `https://heyzine.com/api1?${params.toString()}`;
}

export class HeyzineError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    Object.assign(this, meta);
    this.name = 'HeyzineError';
    this.code = code;
  }
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const PLAN_WORDS = /private api|requires? a plan|plan with|premium|professional plan|standard plan|subscription|upgrade|not available on your plan|plan that includes/i;
const AUTH_WORDS = /api key|invalid user|access token|unauthenticated|not logged in/i;
const MISSING_WORDS = /unauthori[sz]ed|not found|does not exist|no such/i;

function messageOf(body) {
  if (!body || typeof body !== 'object') return '';
  return String(body.msg ?? body.message ?? body.error ?? '');
}

export function classify({ status, body, text = '', endpoint }) {
  if (TRANSIENT_STATUS.has(status)) throw new HeyzineError('transient', `HTTP ${status} from ${endpoint}`, { status, retryable: true, endpoint });
  if (body === undefined) {
    if (status === 404) throw new HeyzineError('not_found', `No such endpoint or resource: ${endpoint} (HTTP 404, non-JSON body)`, { status, endpoint });
    throw new HeyzineError('unknown', `Non-JSON response (HTTP ${status}) from ${endpoint}: ${String(text).replace(/\s+/g, ' ').slice(0, 120)}`, { status, endpoint });
  }
  if (status === 401) throw new HeyzineError('auth', `Heyzine rejected the API key (HTTP 401) on ${endpoint}`, { status, endpoint, body });
  if (status === 403) throw new HeyzineError(PLAN_WORDS.test(messageOf(body)) ? 'plan' : 'auth', `${endpoint}: ${messageOf(body) || 'HTTP 403'}`, { status, endpoint, body });
  if (status === 404) throw new HeyzineError('not_found', `${endpoint}: ${messageOf(body) || 'HTTP 404'}`, { status, endpoint, body });
  if (status === 400) throw new HeyzineError('validation', `${endpoint}: ${messageOf(body) || 'HTTP 400'}`, { status, endpoint, body });
  if (status >= 400) throw new HeyzineError('unknown', `${endpoint}: HTTP ${status} ${messageOf(body)}`.trim(), { status, endpoint, body });
  // Heyzine reports failures as HTTP 200 with success false, so the message decides the code.
  // AUTH_WORDS is tested before the apiCode 403 branch because a bad key arrives as code 403 too,
  // and it must read as auth rather than as a flipbook the account cannot see.
  if (body && typeof body === 'object' && !Array.isArray(body) && body.success === false) {
    const msg = messageOf(body) || 'request failed';
    const apiCode = body.code === undefined ? undefined : Number(body.code);
    const meta = { status, apiCode, endpoint, body };
    if (PLAN_WORDS.test(msg)) throw new HeyzineError('plan', msg, meta);
    if (AUTH_WORDS.test(msg)) throw new HeyzineError('auth', msg, meta);
    if (apiCode === 403 || apiCode === 404 || MISSING_WORDS.test(msg)) {
      throw new HeyzineError('not_found', `${msg} - the id is not in this account, or it is a short id or URL where the REST API needs the full id`, meta);
    }
    throw new HeyzineError('validation', msg, meta);
  }
  return body;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every request carries an AbortSignal, so a hung socket fails loudly instead of parking a
// skill forever. The blocking convert endpoint gets the long one, it really does take minutes.
export const DEFAULT_TIMEOUT_MS = 60000;
export const CONVERT_TIMEOUT_MS = 900000;

const CONVERT_ENDPOINTS = new Set(['async', 'rest']);

// Retrying a write can publish, delete, reorder or grant twice, so only reads and the two
// convert endpoints (idempotent per pdf URL) are retried on a network error, a 429 or a 5xx.
export function retriesTransient(method, endpoint) {
  return String(method).toUpperCase() === 'GET' || CONVERT_ENDPOINTS.has(endpoint);
}

export class HeyzineClient {
  constructor({ key, fetch = globalThis.fetch, sleep = defaultSleep, backoffMs = [1000, 3000, 9000], baseUrl = 'https://heyzine.com/api1', mcpUrl = 'https://heyzine.com/mcp', timeoutMs = DEFAULT_TIMEOUT_MS, convertTimeoutMs = CONVERT_TIMEOUT_MS } = {}) {
    if (!key) throw new HeyzineError('config', 'HeyzineClient needs an API key');
    Object.defineProperty(this, 'key', { value: key, enumerable: false });
    this.fetch = fetch;
    this.sleep = sleep;
    this.backoffMs = backoffMs;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.mcpUrl = mcpUrl;
    this.timeoutMs = timeoutMs;
    this.convertTimeoutMs = convertTimeoutMs;
  }

  async #send(url, init, endpoint, backoffMs = this.backoffMs, timeoutMs = this.timeoutMs) {
    let attempt = 0;
    for (;;) {
      let res;
      let text;
      try {
        // A fresh signal per attempt, so each retry gets the full window rather than the remainder.
        res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        text = await res.text();
      } catch (error) {
        // A timeout is never retried - the server may well be working on the request, and a
        // second convert or write on top of a slow first one is exactly what we must not do.
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
          throw new HeyzineError('timeout', `${endpoint} did not answer within ${timeoutMs} ms`, { retryable: false, endpoint });
        }
        if (attempt < backoffMs.length) { await this.sleep(backoffMs[attempt++]); continue; }
        throw new HeyzineError('transient', `Network error calling ${endpoint}: ${error.message}`, { retryable: true, endpoint });
      }
      if (TRANSIENT_STATUS.has(res.status) && attempt < backoffMs.length) { await this.sleep(backoffMs[attempt++]); continue; }
      let body;
      try { body = JSON.parse(text); } catch { body = undefined; }
      return { status: res.status, body, text };
    }
  }

  async request(method, endpoint, { query, body, backoffMs, timeoutMs } = {}) {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${this.key}`, Accept: 'application/json' };
    const init = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const retries = backoffMs ?? (retriesTransient(method, endpoint) ? this.backoffMs : []);
    const res = await this.#send(url.toString(), init, endpoint, retries, timeoutMs ?? this.timeoutMs);
    return classify({ ...res, endpoint });
  }

  listFlipbooks({ offset, limit } = {}) { return this.request('GET', 'flipbook-list', { query: { limit, offset } }); }
  flipbookDetails(id) { return this.request('GET', 'flipbook-details', { query: { id } }); }
  convertAsync(params) { return this.request('POST', 'async', { body: params }); }
  convertSync(params) { return this.request('POST', 'rest', { body: params, timeoutMs: this.convertTimeoutMs }); }
  updateDesign(id, fields = {}) { return this.request('PATCH', 'flipbook-design', { body: { id, ...fields } }); }
  setSocial(id, fields = {}) { return this.request('POST', 'flipbook-social', { body: { id, ...fields } }); }
  replacePdf(id, pdf) { return this.request('POST', 'flipbook-replace', { body: { id, pdf } }); }
  deleteFlipbook(id) { return this.request('POST', 'flipbook-delete', { body: { id } }); }
  listBookshelves() { return this.request('GET', 'bookshelf-list'); }
  bookshelfFlipbooks(id) { return this.request('GET', 'bookshelf-flipbooks', { query: { id } }); }
  addToBookshelf(id, flipbookId, position) {
    const body = { id, flipbook_id: flipbookId };
    if (position !== undefined && position !== null && position !== '') body.position = Number(position);
    return this.request('POST', 'bookshelf-add', { body });
  }
  removeFromBookshelf(id, flipbookId) { return this.request('POST', 'bookshelf-remove', { body: { id, flipbook_id: flipbookId } }); }
  setBookshelfSocial(id, fields = {}) { return this.request('POST', 'bookshelf-social', { body: { id, ...fields } }); }
  #access(endpoint, params) {
    const { id, name, ...rest } = params;
    const target = id ?? name;
    return this.request('POST', endpoint, { body: { id: target, name: target, ...rest } });
  }
  accessSetup(params) { return this.#access('access-setup', params); }
  accessAdd(params) { return this.#access('access-add', params); }
  accessRemove(params) { return this.#access('access-remove', params); }
  oembed(url, { maxwidth, maxheight } = {}) { return this.request('GET', 'oembed', { query: { url, format: 'json', maxwidth, maxheight } }); }

  async mcpCall(name, args = {}) {
    const init = {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    };
    // One attempt, the same rule as a REST write - an MCP tools/call can be a write too.
    const res = await this.#send(this.mcpUrl, init, `mcp:${name}`, []);
    if (res.status === 401) throw new HeyzineError('auth', 'Heyzine MCP rejected the API key (HTTP 401)', { status: 401, endpoint: 'mcp' });
    if (res.body === undefined) throw new HeyzineError('unknown', `Non-JSON MCP response (HTTP ${res.status}) for ${name}`, { status: res.status, endpoint: 'mcp' });
    if (res.body.error) throw new HeyzineError('validation', `MCP ${name}: ${res.body.error.message}`, { endpoint: 'mcp', body: res.body.error });
    const result = res.body.result || {};
    const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result.isError) {
      const msg = text || 'tool error';
      throw new HeyzineError(PLAN_WORDS.test(msg) ? 'plan' : AUTH_WORDS.test(msg) ? 'auth' : 'validation', `MCP ${name}: ${msg}`, { endpoint: 'mcp' });
    }
    try { return JSON.parse(text); } catch { return text; }
  }

  async searchText(q) {
    const out = await this.mcpCall('heyzine_search_text', { q });
    return out && typeof out === 'object' && Array.isArray(out.data) ? out.data : out;
  }

  pageText(id, page) { return this.mcpCall('heyzine_page_text', { n: id, p: Number(page) }); }
}

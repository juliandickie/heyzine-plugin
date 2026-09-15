import { HeyzineError } from './client.mjs';

export const CONVERT_FIELDS = [
  'template', 'title', 'subtitle', 'description', 'private_note', 'tags', 'download', 'full_screen', 'share',
  'prev_next', 'show_info', 'background_color', 'logo', 'page_effect', 'rtl', 'url_path', 'url_domain', 'replace',
];

export function convertParams({ pdf, clientId, ...rest } = {}) {
  if (!pdf) throw new HeyzineError('validation', 'pdf URL is required');
  if (!clientId) throw new HeyzineError('config', 'client_id is missing - add client_id = "..." to ~/.config/heyzine-plugin/config.toml (from heyzine.com/developers#apikey)');
  const params = { pdf, client_id: clientId };
  for (const field of CONVERT_FIELDS) {
    const value = rest[field];
    if (value === undefined || value === null || value === '') continue;
    params[field] = value;
  }
  return params;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function convertAndWait(client, params, { intervalMs = 5000, timeoutMs = 900000, sleep = defaultSleep, now = Date.now, onPoll = () => {} } = {}) {
  const started = now();
  let polls = 0;
  let current = { ...params };
  for (;;) {
    const last = await client.convertAsync(current);
    polls += 1;
    onPoll(last, polls);
    const state = String(last?.state ?? '').toLowerCase();
    if (state === 'processed' || (state === '' && last?.id)) return { ...last, polls };
    if (state === 'failed') {
      throw new HeyzineError('conversion_failed', `Heyzine reported the conversion failed for ${params.pdf}${last?.msg ? ` - ${last.msg}` : ''}`, { body: last });
    }
    if (now() - started >= timeoutMs) {
      throw new HeyzineError('timeout', `Conversion still ${state || 'pending'} after ${Math.round(timeoutMs / 1000)} s for ${params.pdf} (id ${last?.id ?? 'unknown'}) - poll again later with the same URL, the conversion continues on Heyzine's side`, { body: last, retryable: true });
    }
    if ('replace' in current) { const { replace, ...withoutReplace } = current; current = withoutReplace; }
    await sleep(intervalMs);
  }
}

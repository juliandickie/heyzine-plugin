import { convertParams, convertAndWait } from './convert.mjs';
import { buildRegister, fitNote, assertNote, parseNote, parseTags, FACETS } from './register.mjs';
import { publicUrl, driveDirectUrl, driveFileId, shortId } from './links.mjs';
import { HeyzineError } from './client.mjs';
import { normaliseTitle } from './inventory.mjs';

export const PURPOSE_DEFAULTS = {
  'lead-magnet': { download: true, share: false, full_screen: true, prev_next: true, show_info: false },
  'course-material': { download: true, share: false, full_screen: true, prev_next: true, show_info: false },
  review: { download: true, share: false, full_screen: true, prev_next: true, show_info: false },
  event: { download: false, share: true, full_screen: true, prev_next: true, show_info: false },
  catalog: { download: true, share: true, full_screen: true, prev_next: true, show_info: false },
  other: {},
};

const DOC_EXT = /\.(pdf|docx?|pptx?|odt|odp|rtf)$/i;

export function sourceToUrl(source, { driveForm = 'usercontent' } = {}) {
  const s = String(source ?? '').trim();
  if (/^https?:\/\//i.test(s)) {
    const driveId = /(?:drive|docs)\.google\.com/i.test(s) ? driveFileId(s) : null;
    return driveId ? { url: driveDirectUrl(driveId, { form: driveForm }), driveId } : { url: s, driveId: null };
  }
  const bareId = !/[\\/]/.test(s) && !DOC_EXT.test(s) ? driveFileId(s) : null;
  if (bareId) return { url: driveDirectUrl(bareId, { form: driveForm }), driveId: bareId };
  throw new HeyzineError('validation', `Source must be a public URL or a Google Drive file id or link, got "${s}". Local files are staged to the Drive staging folder first (see the publish skill), then converted from their Drive id.`);
}

const DOC_TYPES = /pdf|msword|officedocument|opendocument|rtf|octet-stream/i;

export async function checkSourceUrl(url, { fetch: f = globalThis.fetch } = {}) {
  const res = await f(url, { method: 'GET', redirect: 'manual', headers: { Range: 'bytes=0-0' } });
  try { await res.body?.cancel?.(); } catch { /* body may already be consumed */ }
  const contentType = res.headers.get('content-type') ?? '';
  const location = res.headers.get('location');
  const redirect = Boolean(location);
  const okStatus = res.status === 200 || res.status === 206;
  let warning = null;
  if (redirect) warning = `redirects to ${location}`;
  else if (!okStatus) warning = `HTTP ${res.status}`;
  else if (contentType && !DOC_TYPES.test(contentType)) warning = `content-type ${contentType}`;
  return { status: res.status, contentType, redirect, location: location ?? null, ok: okStatus && !redirect && warning === null, warning };
}

export async function verifyLive(urls, { fetch: f = globalThis.fetch } = {}) {
  const out = [];
  for (const url of urls.filter(Boolean)) {
    try {
      const res = await f(url, { method: 'GET', redirect: 'follow' });
      try { await res.body?.cancel?.(); } catch { /* ignore */ }
      out.push({ url, status: res.status, ok: res.status === 200 });
    } catch (error) {
      out.push({ url, status: 0, ok: false, error: error.message });
    }
  }
  return out;
}

export function preflightExisting(spec, cache) {
  const items = cache?.items ?? [];
  if (!items.length) return null;
  const s = String(spec.source ?? '').trim();
  const driveKey = /^https?:\/\//i.test(s) ? (/(?:drive|docs)\.google\.com/i.test(s) ? driveFileId(s) : null) : (driveFileId(s) ?? s);
  if (driveKey) {
    const byDrive = items.find((i) => i.register?.fields?.source_drive_id === driveKey);
    if (byDrive) return byDrive;
  }
  const n = normaliseTitle(spec.name);
  if (!n) return null;
  return items.find((i) => normaliseTitle(i.title) === n) ?? null;
}

const RESERVED_FACETS = new Set(FACETS);

// Hand-written tags must not forge a register facet, the register owns purpose, course, link,
// source and published-by. settings.defaultTags is trusted and left alone.
export function freeTags(tags) {
  return parseTags(tags).filter((tag) => {
    const m = tag.match(/^([a-z0-9-]+):/);
    return !(m && RESERVED_FACETS.has(m[1]));
  }).join(',');
}

export async function publishOne(ctx, spec) {
  const { client, settings, fetch: f = globalThis.fetch, today = () => new Date().toISOString().slice(0, 10), pollOptions = {}, driveForm = 'usercontent' } = ctx;
  const { url, driveId } = sourceToUrl(spec.source, { driveForm });
  const purpose = spec.purpose || 'other';
  const defaults = Object.hasOwn(PURPOSE_DEFAULTS, purpose) ? PURPOSE_DEFAULTS[purpose] : null;
  if (!defaults) throw new HeyzineError('validation', `Unknown purpose "${purpose}" - use one of ${Object.keys(PURPOSE_DEFAULTS).join(', ')}`);
  const register = buildRegister({
    purpose, course: spec.course, iddTo: spec.iddTo, sourceDriveId: driveId, sourceName: spec.name, sourceUrl: url,
    embedded: spec.embedded, today: today(), extraTags: [settings.defaultTags, freeTags(spec.tags)].filter(Boolean).join(','),
  });
  // A hand note is free text under the register lines; fit both to Heyzine's 200 character cap.
  const fitted = spec.note ? fitNote({ fields: parseNote(register.private_note).fields, other: parseNote(spec.note).other }) : { note: register.private_note, dropped: register.note_dropped };
  const privateNote = assertNote(fitted.note);
  const params = convertParams({
    pdf: url, clientId: settings.clientId,
    template: spec.template || settings.templateId || undefined,
    title: spec.name, description: spec.description,
    ...defaults, ...(spec.design ?? {}),
    tags: register.tags, private_note: privateNote,
    url_path: spec.urlPath, url_domain: spec.urlDomain || settings.urlDomain || undefined,
    replace: spec.replace ? true : undefined,
  });
  // replace is honoured only on the blocking endpoint. The async endpoint answers processed
  // straight away and leaves the old edition in place (proven live 15 September 2026).
  const converted = spec.replace
    ? { ...(await client.convertSync(params)), state: 'processed', polls: 1 }
    : await convertAndWait(client, params, pollOptions);
  // Every step after this one addresses the flipbook by id, so an answer without one is a
  // dead end that would otherwise surface as an undefined id in the register and the results.
  if (!converted?.id) throw new HeyzineError('unknown', 'Heyzine returned no flipbook id');
  const social = spec.social ?? {};
  await client.setSocial(converted.id, {
    title: social.title || spec.name,
    description: social.description || spec.description || undefined,
    thumbnail: social.thumbnail || converted.thumbnail || undefined,
  });
  // Heyzine reports processed before the title, tags, note and template are visible on
  // flipbook-details, flipbook-list and the rendered page (minutes on 2026-09-15, see the api
  // audit). Wait for the title to settle so the report and the live verify describe the
  // finished flipbook; give up quietly after settleTimeoutMs and say so in the result.
  const { details, settled } = await waitForRegister(client, converted.id, spec.name, pollOptions);
  const share = publicUrl(details, settings.publicHost);
  const base = details.links?.base ?? converted.url;
  const verify = spec.skipVerify ? [] : await verifyLive([...new Set([share, base])], { fetch: f });
  return {
    id: converted.id, short: shortId(converted.id), title: details.title ?? spec.name, pages: details.pages ?? converted.meta?.num_pages ?? null,
    url: share, base, thumbnail: details.links?.thumbnail ?? converted.thumbnail ?? null, pdf: details.links?.pdf ?? null,
    oembed: details.oembed?.html ?? null, tags: details.tags ?? register.tags, private: details.private ?? privateNote,
    source: url, driveId, polls: converted.polls, replaced: Boolean(spec.replace), verify, register_settled: settled, note_dropped: fitted.dropped ?? [],
  };
}

export async function waitForRegister(client, id, name, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, settleIntervalMs = 10000, settleTimeoutMs = 300000 } = {}) {
  const want = normaliseTitle(name);
  const started = now();
  for (;;) {
    const details = await client.flipbookDetails(id);
    if (!want || normaliseTitle(details?.title) === want) return { details, settled: true };
    if (now() - started >= settleTimeoutMs) return { details, settled: false };
    await sleep(settleIntervalMs);
  }
}

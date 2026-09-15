import { convertParams, convertAndWait } from './convert.mjs';
import { buildRegister, mergeNote } from './register.mjs';
import { publicUrl, driveDirectUrl, driveFileId, shortId } from './links.mjs';
import { HeyzineError } from './client.mjs';
import { normaliseTitle } from './inventory.mjs';

export const PURPOSE_DEFAULTS = {
  'lead-magnet': { download: true, share: true, full_screen: true, prev_next: true, show_info: false },
  'course-material': { download: false, share: false, full_screen: true, prev_next: true, show_info: false },
  review: { download: true, share: true, full_screen: true, prev_next: true, show_info: false },
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

export async function publishOne(ctx, spec) {
  const { client, settings, fetch: f = globalThis.fetch, today = () => new Date().toISOString().slice(0, 10), pollOptions = {}, driveForm = 'usercontent' } = ctx;
  const { url, driveId } = sourceToUrl(spec.source, { driveForm });
  const purpose = spec.purpose || 'other';
  const defaults = PURPOSE_DEFAULTS[purpose];
  if (!defaults) throw new HeyzineError('validation', `Unknown purpose "${purpose}" - use one of ${Object.keys(PURPOSE_DEFAULTS).join(', ')}`);
  const register = buildRegister({
    purpose, course: spec.course, iddTo: spec.iddTo, sourceDriveId: driveId, sourceName: spec.name, sourceUrl: url,
    embedded: spec.embedded, today: today(), extraTags: [settings.defaultTags, spec.tags].filter(Boolean).join(','),
  });
  const privateNote = spec.note ? mergeNote(`${register.private_note}\n${spec.note}`, {}) : register.private_note;
  const params = convertParams({
    pdf: url, clientId: settings.clientId,
    template: spec.template || settings.templateId || undefined,
    title: spec.name, description: spec.description,
    ...defaults, ...(spec.design ?? {}),
    tags: register.tags, private_note: privateNote,
    url_path: spec.urlPath, url_domain: spec.urlDomain || settings.urlDomain || undefined,
    replace: spec.replace ? true : undefined,
  });
  const converted = await convertAndWait(client, params, pollOptions);
  const social = spec.social ?? {};
  await client.setSocial(converted.id, {
    title: social.title || spec.name,
    description: social.description || spec.description || undefined,
    thumbnail: social.thumbnail || converted.thumbnail || undefined,
  });
  const details = await client.flipbookDetails(converted.id);
  const share = publicUrl(details, settings.publicHost);
  const base = details.links?.base ?? converted.url;
  const verify = spec.skipVerify ? [] : await verifyLive([...new Set([share, base])], { fetch: f });
  return {
    id: converted.id, short: shortId(converted.id), title: details.title ?? spec.name, pages: details.pages ?? converted.meta?.num_pages ?? null,
    url: share, base, thumbnail: details.links?.thumbnail ?? converted.thumbnail ?? null, pdf: details.links?.pdf ?? null,
    oembed: details.oembed?.html ?? null, tags: details.tags ?? register.tags, private: details.private ?? privateNote,
    source: url, driveId, polls: converted.polls, replaced: Boolean(spec.replace), verify,
  };
}

export const FACETS = ['purpose', 'course', 'link', 'source', 'published-by'];
export const PURPOSES = ['lead-magnet', 'course-material', 'review', 'event', 'catalog', 'other'];

export function slugValue(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseTags(text) {
  const list = Array.isArray(text) ? text : String(text ?? '').split(',');
  return list.map((t) => String(t).trim()).filter(Boolean);
}

export function formatTags(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of parseTags(tags)) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.join(',');
}

const FACET_TAG = /^([a-z0-9-]+):(.+)$/;

export function tagFacets(tags) {
  const facets = {};
  const plain = [];
  for (const tag of parseTags(tags)) {
    const m = tag.match(FACET_TAG);
    if (m && FACETS.includes(m[1])) (facets[m[1]] ||= []).push(m[2]);
    else plain.push(tag);
  }
  return { facets, plain };
}

export function mergeTags(existing, additions, { replaceFacets = [] } = {}) {
  const keep = parseTags(existing).filter((tag) => {
    const m = tag.match(FACET_TAG);
    return !(m && replaceFacets.includes(m[1]));
  });
  return formatTags([...keep, ...parseTags(additions)]);
}

const NOTE_LINE = /^([a-z][a-z0-9_]*)\s*=\s*(.*)$/;

export function parseNote(text) {
  const fields = {};
  const other = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const m = line.match(NOTE_LINE);
    if (m) fields[m[1]] = m[2].trim();
    else other.push(line);
  }
  return { fields, other };
}

export function formatNote({ fields = {}, other = [] } = {}) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k} = ${String(v).replace(/\r?\n/g, ' ').trim()}`);
  return [...lines, ...other].join('\n');
}

export function mergeNote(existingText, newFields = {}) {
  const { fields, other } = parseNote(existingText);
  return formatNote({ fields: { ...fields, ...newFields }, other });
}

export function buildRegister({ purpose, course, iddTo, sourceDriveId, sourceName, sourceUrl, embedded, today, extraTags = '' } = {}) {
  if (!PURPOSES.includes(purpose)) throw new Error(`purpose must be one of ${PURPOSES.join(', ')}`);
  if (!sourceDriveId && !sourceUrl) throw new Error('buildRegister needs sourceDriveId or sourceUrl');
  const tags = [`purpose:${purpose}`];
  if (course) tags.push(`course:${slugValue(course)}`);
  if (iddTo) tags.push(`link:${slugValue(iddTo)}`);
  tags.push(sourceDriveId ? 'source:drive' : 'source:url');
  tags.push('published-by:heyzine-plugin');
  const fields = {
    source_drive_id: sourceDriveId,
    source_name: sourceName,
    source_url: sourceDriveId ? undefined : sourceUrl,
    idd_to: iddTo ? slugValue(iddTo) : undefined,
    embedded: Array.isArray(embedded) ? embedded.join('; ') : embedded,
    published: today,
    published_by: 'heyzine-plugin',
  };
  return { tags: mergeTags(extraTags, tags), private_note: formatNote({ fields }) };
}

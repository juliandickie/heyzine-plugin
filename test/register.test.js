import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACETS, PURPOSES, slugValue, parseTags, formatTags, tagFacets, mergeTags,
  parseNote, formatNote, mergeNote, buildRegister,
} from '../lib/register.mjs';
import { NOTE_MAX, fitNote, assertNote } from '../lib/register.mjs';

test('slugValue lowercases and hyphenates', () => {
  assert.equal(slugValue(' PCP Flowchart: Zirconia! '), 'pcp-flowchart-zirconia');
  assert.equal(slugValue('ios_review_medit-i900'), 'ios-review-medit-i900');
});

test('parse, format and facet tags', () => {
  assert.deepEqual(parseTags(' a, b ,,c'), ['a', 'b', 'c']);
  assert.equal(formatTags(['a', 'b', 'a', ' ']), 'a,b');
  assert.deepEqual(tagFacets('purpose:lead-magnet,course:pcp,summer,link:pcp-zirconia,unknown:x'), {
    facets: { purpose: ['lead-magnet'], course: ['pcp'], link: ['pcp-zirconia'] },
    plain: ['summer', 'unknown:x'],
  });
  assert.deepEqual(FACETS, ['purpose', 'course', 'link', 'source', 'published-by']);
  assert.ok(PURPOSES.includes('course-material'));
});

test('mergeTags replaces named facets and dedupes', () => {
  assert.equal(mergeTags('purpose:review,summer,link:old', ['purpose:lead-magnet', 'link:new', 'summer'], { replaceFacets: ['purpose', 'link'] }), 'summer,purpose:lead-magnet,link:new');
  assert.equal(mergeTags('', 'a,b'), 'a,b');
  assert.equal(mergeTags('a', ''), 'a');
});

test('parseNote keeps unknown lines and formatNote round-trips', () => {
  const text = 'source_drive_id = 1AbC\nHand written reminder\nidd_to = pcp-zirconia\n\n';
  const parsed = parseNote(text);
  assert.deepEqual(parsed, { fields: { source_drive_id: '1AbC', idd_to: 'pcp-zirconia' }, other: ['Hand written reminder'] });
  assert.equal(formatNote(parsed), 'source_drive_id = 1AbC\nidd_to = pcp-zirconia\nHand written reminder');
  assert.equal(formatNote({ fields: { a: '', b: undefined, c: 'x\ny' } }), 'c = x y');
});

test('mergeNote overrides fields and preserves the rest', () => {
  const merged = mergeNote('published = 2026-01-01\nkeep me\nidd_to = old', { published: '2026-09-15', embedded: 'academy:chapter:123' });
  assert.equal(merged, 'published = 2026-09-15\nidd_to = old\nembedded = academy:chapter:123\nkeep me');
});

test('buildRegister produces the spec section 5 shape', () => {
  const r = buildRegister({
    purpose: 'course-material', course: 'PCP', iddTo: 'pcp-flowchart-zirconia', sourceDriveId: '1AbC',
    sourceName: 'Flowchart - Zirconia.pdf', embedded: ['academy:chapter:123', 'academy:lesson:124'],
    today: '2026-09-15', extraTags: 'published-by:heyzine-plugin,summer',
  });
  assert.equal(r.tags, 'published-by:heyzine-plugin,summer,purpose:course-material,course:pcp,link:pcp-flowchart-zirconia,source:drive');
  assert.equal(r.private_note, [
    'source_drive_id = 1AbC', 'source_name = Flowchart - Zirconia.pdf', 'idd_to = pcp-flowchart-zirconia',
    'embedded = academy:chapter:123; academy:lesson:124', 'published = 2026-09-15', 'published_by = heyzine-plugin',
  ].join('\n'));
  assert.deepEqual(r.note_dropped, []);
  const u = buildRegister({ purpose: 'lead-magnet', sourceUrl: 'https://x/y.pdf', today: '2026-09-15' });
  assert.equal(u.tags, 'purpose:lead-magnet,source:url,published-by:heyzine-plugin');
  assert.match(u.private_note, /^source_url = https:\/\/x\/y\.pdf\n/);
  assert.throws(() => buildRegister({ purpose: 'nope' }), /purpose must be one of/);
  assert.throws(() => buildRegister({ sourceUrl: 'https://x/y.pdf' }), /purpose must be one of/);
  assert.throws(() => buildRegister({ purpose: 'other' }), /sourceDriveId or sourceUrl/);
});

test('fitNote drops published_by, then source_url, then source_name until the note fits 200 characters', () => {
  const longUrl = 'https://courses.example.com/wp-content/uploads/2024/10/' + 'x'.repeat(120) + '.pdf';
  const fields = { source_name: 'A long resource name for a review document', source_url: longUrl, idd_to: 'slug', embedded: 'academy:chapter:456', published: '2026-09-15', published_by: 'heyzine-plugin' };
  const { note, dropped } = fitNote({ fields });
  assert.ok(note.length <= NOTE_MAX, note.length);
  assert.deepEqual(dropped, ['published_by', 'source_url']);
  assert.match(note, /^source_name = A long/);
  assert.match(note, /idd_to = slug/);
  const short = fitNote({ fields: { idd_to: 'slug', published: '2026-09-15' } });
  assert.deepEqual(short.dropped, []);
  assert.throws(() => assertNote('a'.repeat(NOTE_MAX + 1)), (e) => e.code === 'validation' && /201 characters/.test(e.message));
  assert.equal(assertNote('a'.repeat(NOTE_MAX)).length, NOTE_MAX);
});

test('buildRegister trims a long source_url and reports what it dropped', () => {
  const r = buildRegister({ purpose: 'review', iddTo: 'ios-review-x', sourceUrl: 'https://example.com/' + 'y'.repeat(180) + '.pdf', sourceName: 'X Review', embedded: 'academy:chapter:1', today: '2026-09-15' });
  assert.ok(r.private_note.length <= NOTE_MAX);
  assert.deepEqual(r.note_dropped, ['published_by', 'source_url']);
  assert.match(r.tags, /published-by:heyzine-plugin/);
});

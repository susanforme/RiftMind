import { expect, it } from 'vitest';
import type { NotebookEntry, NotebookKind } from '../../src/generated/contracts';
import { blankNotebook } from '../../src/features/champion-notes/notebook-drafts';
import {
  filterNotebookEntries,
  reviewStatus,
} from '../../src/features/champion-notes/notebook-browser';

const filters = { category: 'all' as const, query: '', patch: '', review: 'all', sort: 'updated' };

function notebook(id: string, kind: NotebookKind, title: string): NotebookEntry {
  return {
    id,
    content: { ...blankNotebook(64, kind), title },
    revision: 2,
    reviewedRevision: null,
    deleted: false,
    updatedAt: '2026-10-19T12:00:00Z',
  };
}

it('searches titles, body and tags across categories, combines filters, and preserves the source', () => {
  const route = notebook('route', 'note', 'Jungle path');
  route.content.tags = ['Vision'];
  const combo = notebook('combo', 'combo', 'Ward hop');
  combo.content.text = 'Vision before engaging';
  const matchup = notebook('matchup', 'matchup', 'Vision against Ahri');
  matchup.content.opponentId = 103;
  const entries = [route, combo, matchup];
  const original = structuredClone(entries);
  expect(filterNotebookEntries(entries, { ...filters, query: ' VISION ' })).toHaveLength(3);
  expect(
    filterNotebookEntries(entries, {
      ...filters,
      query: 'vision',
      category: 'matchup',
      opponent: 103,
    }).map((entry) => entry.id),
  ).toEqual(['matchup']);
  expect(filterNotebookEntries(entries, { ...filters, opponent: 99 })).toEqual([]);
  expect(entries).toEqual(original);
});

it('keeps pinned entries first while sorting the remaining entries by recency or title', () => {
  const pinned = notebook('pinned', 'note', 'Zed');
  pinned.content.pinned = true;
  pinned.updatedAt = '2025-01-01T00:00:00Z';
  const recent = notebook('recent', 'combo', 'Ward hop');
  const older = notebook('older', 'build', 'Boots');
  older.updatedAt = '2026-10-18T12:00:00Z';
  const entries = [older, recent, pinned];
  expect(filterNotebookEntries(entries, filters).map((entry) => entry.id)).toEqual([
    'pinned',
    'recent',
    'older',
  ]);
  expect(
    filterNotebookEntries(entries, { ...filters, sort: 'title' }).map((entry) => entry.id),
  ).toEqual(['pinned', 'older', 'recent']);
});

it('requires review for changed content or another target patch, without requiring a target to read confirmed entries', () => {
  const entry = notebook('reviewed', 'note', 'Ward route');
  expect(reviewStatus(entry)).toBe('unmarked');
  entry.content.confirmedPatch = '16.20';
  entry.reviewedRevision = entry.revision;
  expect(reviewStatus(entry)).toBe('confirmed');
  expect(reviewStatus(entry, '16.20')).toBe('confirmed');
  expect(reviewStatus(entry, '16.21')).toBe('needs_review');
  entry.revision++;
  expect(reviewStatus(entry, '16.20')).toBe('needs_review');
  expect(filterNotebookEntries([entry], { ...filters, review: 'confirmed' })).toEqual([]);
});

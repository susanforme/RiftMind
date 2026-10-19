import type { NotebookEntry, NotebookKind } from '../../generated/contracts';

export const notebookKinds: NotebookKind[] = ['build', 'note', 'combo', 'matchup'];
export type NotebookCategory = NotebookKind | 'all';

export function reviewStatus(entry: NotebookEntry, patch?: string) {
  return !entry.content.confirmedPatch
    ? 'unmarked'
    : (patch && entry.content.confirmedPatch !== patch) || entry.reviewedRevision !== entry.revision
      ? 'needs_review'
      : 'confirmed';
}

export function filterNotebookEntries(
  entries: NotebookEntry[],
  filters: {
    category: NotebookCategory;
    query: string;
    opponent?: number;
    patch: string;
    review: string;
    sort: string;
  },
) {
  const query = filters.query.trim().toLocaleLowerCase();
  return entries
    .filter((entry) => {
      const content = entry.content;
      return (
        (filters.category === 'all' || content.kind === filters.category) &&
        (!filters.opponent || content.opponentId === filters.opponent) &&
        `${content.title} ${content.text} ${content.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(query) &&
        (filters.review === 'all' || reviewStatus(entry, filters.patch) === filters.review)
      );
    })
    .sort(
      (left, right) =>
        Number(right.content.pinned) - Number(left.content.pinned) ||
        (filters.sort === 'title'
          ? left.content.title.localeCompare(right.content.title)
          : right.updatedAt.localeCompare(left.updatedAt)) ||
        left.id.localeCompare(right.id),
    );
}

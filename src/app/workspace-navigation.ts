import type { WorkspaceTab } from '../generated/contracts';
import { validateSearch, type Search } from './router';

export function readWorkspaceSearch(tab: WorkspaceTab): Search {
  try {
    return validateSearch(JSON.parse(tab.search));
  } catch {
    return {};
  }
}

export function workspaceTabForLocation(pathname: string, search: Search): WorkspaceTab {
  const reviewMatch = pathname.match(/^\/matches\/([^/]+)\/review$/)?.[1];
  const playerKey = search.player || null;
  const playerId = playerKey || 'current';
  const kind = reviewMatch ? 'review' : pathname.slice(1) || 'matches';
  const id =
    kind === 'review'
      ? `review:${playerKey || 'unknown'}:${decodeURIComponent(reviewMatch!)}`
      : kind === 'notebooks'
        ? `notebooks:${search.champion || 64}`
        : ['players', 'champions', 'progress'].includes(kind)
          ? `${kind}:${playerId}`
          : kind === 'matches'
            ? search.tab || (playerKey ? `matches:${playerKey}` : 'matches')
            : kind === 'compare'
              ? search.tab || 'compare'
              : kind;
  return {
    id,
    kind,
    playerKey: kind === 'settings' ? null : playerKey,
    search: JSON.stringify(
      reviewMatch ? { ...search, match: decodeURIComponent(reviewMatch) } : search,
    ),
  };
}

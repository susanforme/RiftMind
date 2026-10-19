import type { WorkspaceTab } from '../generated/contracts';
import { queryClient } from './query-client';

const workspaceQueryPrefixes: Record<string, string[]> = {
  matches: ['matches', 'match-scoreboard', 'preparations', 'task', 'players', 'connection'],
  players: ['player-overview', 'favorites', 'players', 'connection'],
  live: ['live', 'player-profile', 'live-recent-matches', 'connection'],
  champions: ['champion-pool', 'players', 'connection'],
  progress: [
    'goals',
    'goal-progress',
    'player-progress',
    'issues',
    'practices',
    'preparations',
    'players',
    'connection',
  ],
  review: [
    'review-data',
    'review-chart',
    'timeline',
    'review-evidence',
    'annotations',
    'personal-baseline',
    'event-context',
    'task',
  ],
  compare: ['comparison', 'compare-chart', 'compare-events', 'compare-candidates'],
  notebooks: [
    'notebooks',
    'practices',
    'notebook-history',
    'notebook-link',
    'notebook-review-source',
  ],
  settings: ['settings', 'connection', 'instances', 'usage', 'app'],
};

export function invalidateWorkspaceTabQueries(tab: WorkspaceTab) {
  const prefixes = workspaceQueryPrefixes[tab.kind] || [];
  // The refreshed instance refetches on mount; other open instances keep their state.
  return queryClient.invalidateQueries({
    predicate: (query) => prefixes.includes(String(query.queryKey[0])),
    refetchType: 'none',
  });
}

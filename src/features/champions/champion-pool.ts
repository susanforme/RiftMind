import { useQuery } from '@tanstack/react-query';
import type { Search } from '../../app/router';
import { transport } from '../../app/runtime';
import type { ChampionQuery } from '../../generated/contracts';
import { toAnalysisFilter } from '../analysis/analysis-filter';

export const championQueueIds = [420, 440, 430, 400, 450, 2400, 480, 490, 900, 1900, 1710, 2300];
export const championPageSize = 6;

export function selectedChampionQueues(search: Search) {
  return search.queues ?? [search.queue ?? 420];
}

export function championPoolRequest(
  playerKey: string,
  search: Search,
  sort = 'games',
  cursor: number | null = null,
  limit = championPageSize,
): ChampionQuery {
  return {
    filter: toAnalysisFilter(playerKey, { ...search, queue: undefined }),
    queueIds: selectedChampionQueues(search),
    sort,
    cursor: cursor ?? 0,
    limit,
  };
}

export function useChampionPool(
  playerKey: string | undefined,
  workspaceEpoch: string | undefined,
  search: Search,
  sort = 'games',
  cursor: number | null = null,
  limit = championPageSize,
  enabled = true,
) {
  const request = championPoolRequest(playerKey || '', search, sort, cursor, limit);
  return useQuery({
    queryKey: ['champion-pool', workspaceEpoch, playerKey, request],
    queryFn: () => transport.call('get_champion_pool', request),
    enabled: enabled && !!playerKey && !!workspaceEpoch,
    placeholderData: (previous, previousQuery) =>
      !!previousQuery &&
      previousQuery.queryKey[1] === workspaceEpoch &&
      previousQuery.queryKey[2] === playerKey &&
      JSON.stringify((previousQuery.queryKey[3] as ChampionQuery).filter) ===
        JSON.stringify(request.filter) &&
      JSON.stringify((previousQuery.queryKey[3] as ChampionQuery).queueIds) ===
        JSON.stringify(request.queueIds)
        ? previous
        : undefined,
  });
}

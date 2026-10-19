import type { RankEntry } from '../../generated/contracts';

export const soloRankQueue = 'RANKED_SOLO_5x5';
export const flexRankQueue = 'RANKED_FLEX_SR';

export function normalizeRankQueue(queue: string) {
  const normalized = queue.toUpperCase();
  if (normalized === '420' || normalized === 'RANKED_SOLO_5X5') return soloRankQueue;
  if (normalized === '440' || normalized === flexRankQueue) return flexRankQueue;
  return queue;
}

export function rankQueueForRoom(queueId: number | null) {
  return queueId === 440 ? flexRankQueue : soloRankQueue;
}

export function rankForRoom(ranks: RankEntry[], queueId: number | null) {
  const queue = rankQueueForRoom(queueId);
  return ranks.find((rank) => normalizeRankQueue(rank.queue) === queue);
}

export function allRankQueues(ranks: RankEntry[]) {
  return [
    ...new Set([
      soloRankQueue,
      flexRankQueue,
      ...ranks.map((rank) => normalizeRankQueue(rank.queue)),
    ]),
  ].map((queue) => ({
    queue,
    rank: ranks.find((rank) => normalizeRankQueue(rank.queue) === queue),
  }));
}

export function rankedTier(rank: RankEntry | undefined) {
  const tier = rank?.tier?.toUpperCase();
  return tier && tier !== 'NONE' && tier !== 'UNRANKED' ? tier : null;
}

export function rankDivision(rank: RankEntry | undefined) {
  const tier = rankedTier(rank);
  if (!tier || ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) return '';
  const division = rank?.division || '';
  return /^(I|II|III|IV)$/.test(division) ? division : '';
}

import type { AnalysisFilter } from '../../generated/contracts';
import type { Search } from '../../app/router';
export function toAnalysisFilter(playerKey: string, search: Search): AnalysisFilter {
  return {
    playerKey,
    queueId: search.queue || null,
    position: search.position || null,
    patch: search.patch || null,
    championId: search.champion || null,
    from: search.from ? new Date(`${search.from}T00:00:00`).toISOString() : null,
    to: search.to ? new Date(`${search.to}T23:59:59.999`).toISOString() : null,
  };
}

import type { MatchSummary, RankEntry } from '../../generated/contracts';

export const rankedTiers = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const;

export function rankScore(rank: RankEntry): number | null {
  const tier = rankedTiers.indexOf(rank.tier?.toUpperCase() as (typeof rankedTiers)[number]);
  if (tier < 0 || rank.points === null) return null;
  // All apex tiers share the same LP ladder; promotions must not create artificial jumps.
  if (tier >= 7) return 2800 + rank.points;
  const division = ['IV', 'III', 'II', 'I'].indexOf(rank.division || '');
  return division < 0 ? null : tier * 400 + division * 100 + rank.points;
}

export function positionStats(matches: MatchSummary[]) {
  return ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN']
    .map((position) => {
      const games = matches.filter((match) => {
        const code = match.position?.toUpperCase();
        const aliases: Record<string, string> = {
          MID: 'MIDDLE',
          BOT: 'BOTTOM',
          SUPPORT: 'UTILITY',
        };
        const normalized = aliases[code || ''] || code;
        return (
          (normalized && ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(normalized)
            ? normalized
            : 'UNKNOWN') === position
        );
      });
      const wins = games.filter((match) => match.outcome === 'win').length;
      const decided = games.filter(
        (match) => match.outcome === 'win' || match.outcome === 'loss',
      ).length;
      return { position, games: games.length, winRate: decided ? wins / decided : null };
    })
    .filter((row) => row.games > 0)
    .sort((left, right) => right.games - left.games);
}

export function overviewPerformance(matches: MatchSummary[]) {
  const decided = matches.filter((match) => match.outcome === 'win' || match.outcome === 'loss');
  const complete = decided.filter(
    (match) => match.kills != null && match.deaths != null && match.assists != null,
  );
  const total = complete.reduce(
    (stats, match) => ({
      kills: stats.kills + match.kills!,
      deaths: stats.deaths + match.deaths!,
      assists: stats.assists + match.assists!,
    }),
    { kills: 0, deaths: 0, assists: 0 },
  );
  const farm = decided.filter(
    (match) => match.cs != null && match.duration != null && match.duration > 0,
  );
  const minutes = farm.reduce((sum, match) => sum + match.duration! / 60, 0);
  return {
    wins: decided.filter((match) => match.outcome === 'win').length,
    losses: decided.filter((match) => match.outcome === 'loss').length,
    kda: complete.length ? (total.kills + total.assists) / Math.max(1, total.deaths) : null,
    csPerMinute: minutes ? farm.reduce((sum, match) => sum + match.cs!, 0) / minutes : null,
    kdaSamples: complete.length,
    farmSamples: farm.length,
  };
}

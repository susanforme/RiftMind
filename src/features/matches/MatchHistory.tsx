import type { MatchSummary } from '../../generated/contracts';
export { MatchHistoryRow } from './MatchHistoryRow';

export function groupMatchesByDate(matches: MatchSummary[], locale: string) {
  const groups = new Map<string, MatchSummary[]>();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  for (const match of matches) {
    const date = dateFormatter.format(new Date(match.startedAt));
    const group = groups.get(date) || [];
    group.push(match);
    groups.set(date, group);
  }
  return [...groups].map(([date, matches]) => ({ date, matches }));
}

export function recentMatchStats(matches: MatchSummary[]) {
  const wins = matches.filter((match) => match.outcome === 'win').length;
  const losses = matches.filter((match) => match.outcome === 'loss').length;
  const complete = matches.filter(
    (match) => match.kills !== null && match.deaths !== null && match.assists !== null,
  );
  const kills = complete.reduce((total, match) => total + match.kills!, 0);
  const deaths = complete.reduce((total, match) => total + match.deaths!, 0);
  const assists = complete.reduce((total, match) => total + match.assists!, 0);
  return {
    wins,
    losses,
    winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : null,
    kda: complete.length ? ((kills + assists) / Math.max(1, deaths)).toFixed(1) : null,
  };
}

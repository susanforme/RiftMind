import { expect, it } from 'vitest';
import type { MatchSummary, RankEntry } from '../../src/generated/contracts';
import {
  overviewPerformance,
  positionStats,
  rankScore,
} from '../../src/features/players/player-overview';

it('keeps LP continuous across divisions and the shared apex ladder', () => {
  const rank: RankEntry = { queue: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'I', points: 99 };
  expect(rankScore(rank)).toBe(1599);
  expect(rankScore({ ...rank, tier: 'PLATINUM', division: 'IV', points: 0 })).toBe(1600);
  expect(rankScore({ ...rank, tier: 'MASTER', division: null, points: 500 })).toBe(3300);
  expect(rankScore({ ...rank, tier: 'GRANDMASTER', division: null, points: 500 })).toBe(3300);
  expect(rankScore({ ...rank, tier: null })).toBeNull();
  expect(rankScore({ ...rank, points: null })).toBeNull();
});

it('uses decided games for performance and normalizes unknown position samples', () => {
  const matches = [
    { outcome: 'win', kills: 5, deaths: 0, assists: 10, position: 'MID', cs: 180, duration: 1800 },
    {
      outcome: 'loss',
      kills: 1,
      deaths: 5,
      assists: 4,
      position: 'MIDDLE',
      cs: 120,
      duration: 1200,
    },
    { outcome: 'remake', kills: 20, deaths: 0, assists: 10, position: null, cs: 10, duration: 180 },
    {
      outcome: 'unknown',
      kills: null,
      deaths: null,
      assists: null,
      position: 'FILL',
      cs: null,
      duration: null,
    },
  ] as MatchSummary[];
  expect(positionStats(matches)).toEqual([
    { position: 'MIDDLE', games: 2, winRate: 0.5 },
    { position: 'UNKNOWN', games: 2, winRate: null },
  ]);
  expect(overviewPerformance(matches)).toEqual({
    wins: 1,
    losses: 1,
    kda: 4,
    csPerMinute: 6,
    kdaSamples: 2,
    farmSamples: 2,
  });
  expect(overviewPerformance([]).kda).toBeNull();
  expect(overviewPerformance([{ ...matches[0], deaths: null }]).kda).toBeNull();
});

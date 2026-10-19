// Development preview only; core/harness is authoritative for calculations and persistence.
import raw from '../../../tests/fixtures/scouting/live.json';
import lobby from '../../../tests/fixtures/scouting/lobby.json';
import type { CommandName } from './index';
import type {
  CommandMap,
  ConnectionState,
  MatchSummary,
  Player,
  SampleMetric,
} from '../../generated/contracts';
import { reviewFixture } from './review-fixture';
let favorites: Player[] = [];
let players: Player[] = [];
let partySize: number | null = null;
export function setScoutingPartySize(size: number | null) {
  partySize = size;
}
export function resetScoutingFixture() {
  favorites = [];
  players = [];
  partySize = null;
}
const mean = (values: (number | null)[]): SampleMetric => {
  const valid = values.filter((v): v is number => v != null);
  return {
    value: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    samples: valid.length,
    excluded: { missing: values.length - valid.length },
  };
};
export function scoutingFixture(
  command: CommandName,
  args: unknown,
  c: {
    matches: MatchSummary[];
    connection: ConnectionState;
    now: Date;
    emit: (kind: string) => void;
    fail: (code: string) => never;
  },
  review: Parameters<typeof reviewFixture>[2],
): unknown {
  const logged = c.connection.player;
  const key = (args as { playerKey?: string }).playerKey;
  switch (command) {
    case 'get_live_snapshot':
      if (logged && partySize !== null) {
        return {
          sessionEpoch: c.connection.sessionEpoch,
          generation: 'fixture-party',
          revision: 1,
          phase: 'Lobby',
          gameId: null,
          queueId: lobby.gameConfig.queueId,
          mode: lobby.gameConfig.gameMode,
          bans: [],
          seats: lobby.members.slice(0, partySize).map((member, index) => ({
            seat: index,
            teamId: 0,
            player: {
              playerKey: `${logged.serverId}:${member.puuid}`,
              serverId: logged.serverId,
              puuid: member.puuid,
              displayName: member.summonerName,
              profileIconId: member.summonerIconId,
              summonerLevel: member.summonerLevel,
              updatedAt: c.now.toISOString(),
            },
            championId: null,
            spellIds: [],
            position: member.firstPositionPreference,
            current: member.puuid === logged.puuid,
          })),
          stale: false,
          updatedAt: c.now.toISOString(),
          matchKey: null,
          error: null,
        };
      }
      return {
        sessionEpoch: c.connection.sessionEpoch,
        generation: 'fixture-live',
        revision: 1,
        phase: logged ? 'ChampSelect' : 'None',
        gameId: null,
        error: null,
        queueId: 420,
        mode: 'CLASSIC',
        bans: [157, 266, 99],
        seats: logged
          ? [...raw.champSelect.myTeam, ...raw.champSelect.theirTeam].map((p, i) => ({
              seat: p.cellId,
              teamId: i < 5 ? 100 : 200,
              player: {
                playerKey: `${logged.serverId}:${p.puuid}`,
                serverId: logged.serverId,
                puuid: p.puuid,
                displayName: `${p.gameName}#${p.tagLine}`,
                profileIconId: null,
                summonerLevel: null,
                updatedAt: c.now.toISOString(),
              },
              championId: p.championId,
              spellIds: [4, 14],
              position: p.assignedPosition,
              current: i === 0,
            }))
          : [],
        stale: !logged,
        updatedAt: c.now.toISOString(),
        matchKey: null,
      };
    case 'search_player': {
      if (!logged) return c.fail('client_not_found');
      const q = (args as CommandMap['search_player']['input']).query;
      const p = {
        ...logged,
        playerKey: `${logged.serverId}:searched-player`,
        puuid: 'searched-player',
        displayName: q,
      };
      players = [p];
      return p;
    }
    case 'list_favorites':
      return favorites;
    case 'set_favorite': {
      const q = args as CommandMap['set_favorite']['input'];
      if (q.workspaceEpoch !== 'fixture-epoch') return c.fail('session_changed');
      const p = [
        logged,
        ...players,
        ...raw.champSelect.myTeam.map((p) =>
          logged
            ? {
                ...logged,
                playerKey: `${logged.serverId}:${p.puuid}`,
                puuid: p.puuid,
                displayName: p.gameName,
              }
            : null,
        ),
      ].find((p) => p?.playerKey === q.playerKey);
      if (q.favorite && !p) return c.fail('not_found');
      favorites = favorites.filter((p) => p.playerKey !== q.playerKey);
      if (q.favorite && p) favorites.push(p);
      c.emit('favorites-changed');
      return favorites;
    }
    case 'get_player_profile':
    case 'get_player_overview': {
      if (!logged) return c.fail('client_not_found');
      const p = players.find((p) => p.playerKey === key) || {
        ...logged,
        playerKey: key!,
        displayName: key === logged.playerKey ? logged.displayName : key!,
      };
      const queueId = (args as CommandMap['get_player_profile']['input']).queueId;
      const matches = c.matches.filter(
        (match) => match.playerKey === key && (!queueId || match.queueId === queueId),
      );
      const profile = {
        player: p,
        source: 'sgp',
        collectedAt: c.now.toISOString(),
        ranks: [],
        rankError: null,
        queueId,
        games: matches.length,
        winRate: mean(
          matches
            .filter((match) => match.outcome === 'win' || match.outcome === 'loss')
            .map((match) => (match.outcome === 'win' ? 1 : 0)),
        ),
        kda: mean([]),
        champions: [],
        championGames: 0,
        championWinRate: mean([]),
        championKda: mean([]),
      };
      return command === 'get_player_overview'
        ? {
            profile,
            matches: key === logged.playerKey ? matches : matches.slice(0, 50),
            rankHistory: [],
            isSelf: key === logged.playerKey,
            historyError: null,
          }
        : profile;
    }
    case 'get_champion_pool': {
      const q = args as CommandMap['get_champion_pool']['input'];
      const queues = q.queueIds ?? [q.filter.queueId ?? 420];
      const matches = c.matches.filter(
        (m) =>
          m.playerKey === q.filter.playerKey &&
          m.outcome !== 'remake' &&
          (!queues.length || (m.queueId != null && queues.includes(m.queueId))) &&
          (!q.filter.championId || m.championId === q.filter.championId) &&
          (!q.filter.position || m.position === q.filter.position) &&
          (!q.filter.patch || m.version.startsWith(`${q.filter.patch}.`)) &&
          (!q.filter.from || m.startedAt >= q.filter.from) &&
          (!q.filter.to || m.startedAt <= q.filter.to),
      );
      const champions = [...new Set(matches.map((m) => m.championId))].map((championId) => {
        const rows = matches.filter((m) => m.championId === championId);
        return {
          championId,
          games: rows.length,
          winRate: mean(
            rows.map((m) => (m.outcome === 'win' ? 1 : m.outcome === 'loss' ? 0 : null)),
          ),
          kills: mean(rows.map((m) => m.kills)),
          deaths: mean(rows.map((m) => m.deaths)),
          assists: mean(rows.map((m) => m.assists)),
          kda: mean(
            rows.map((m) =>
              m.deaths && m.kills != null && m.assists != null
                ? (m.kills + m.assists) / m.deaths
                : null,
            ),
          ),
          csPerMin: mean([]),
          damageShare: mean([]),
          trend: rows.slice(0, 20).map((m) => ({
            matchKey: m.matchKey,
            startedAt: m.startedAt,
            outcome: m.outcome,
            group: `${m.queueId}:${m.position}:${m.version.split('.').slice(0, 2).join('.')}`,
          })),
        };
      });
      const sortValue = (champion: (typeof champions)[number]) => {
        switch (q.sort) {
          case 'win_rate':
            return champion.winRate.value;
          case 'kda':
            return champion.kda.value;
          case 'cs_per_min':
            return champion.csPerMin.value;
          case 'damage_share':
            return champion.damageShare.value;
          default:
            return champion.games;
        }
      };
      champions.sort(
        (left, right) =>
          (sortValue(right) ?? -Infinity) - (sortValue(left) ?? -Infinity) ||
          (left.championId ?? 0) - (right.championId ?? 0),
      );
      const cursor = q.cursor ?? 0;
      const limit = q.limit ?? 50;
      return {
        items: champions.slice(cursor, cursor + limit),
        nextCursor: cursor + limit < champions.length ? cursor + limit : null,
        cachedMatches: c.matches.filter((match) => match.playerKey === q.filter.playerKey).length,
        filteredMatches: matches.length,
        from: matches[matches.length - 1]?.startedAt || null,
        to: matches[0]?.startedAt || null,
        truncated: false,
      };
    }
    case 'compare_matches': {
      const q = args as CommandMap['compare_matches']['input'];
      if (q.left.matchKey === q.right.matchKey) return c.fail('invalid_input');
      const read = (side: typeof q.left) =>
        reviewFixture(
          'get_match_review_data',
          { ...side, reportId: side.reportId === 'none' ? null : side.reportId },
          review,
        ) as CommandMap['get_match_review_data']['output'];
      const left = read(q.left);
      const right = read(q.right);
      return {
        left,
        right,
        metrics: [],
        differences: [],
        durationMs: Math.max(left.summary.duration || 0, right.summary.duration || 0) * 1000,
      };
    }
    case 'get_issue_summary':
      return { items: [], nextCursor: null, reports: 0, truncated: false };
    default:
      return undefined;
  }
}
export function scoutingPlayers() {
  return players;
}

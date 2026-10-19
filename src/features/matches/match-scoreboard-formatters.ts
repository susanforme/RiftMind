import type { ScoreboardParticipant, ScoreboardTeam } from '../../generated/contracts';
import type { TFunction } from 'i18next';

export function scoreboardTeamName(t: TFunction, teamId: number) {
  return t(
    teamId === 100 ? 'matches.blueTeam' : teamId === 200 ? 'matches.redTeam' : 'matches.team',
    { team: teamId },
  );
}

export function formatMatchKda(
  kills: number | null,
  deaths: number | null,
  assists: number | null,
) {
  if (kills === null || deaths === null || assists === null) return '—';
  return deaths === 0 ? 'Perfect' : `${((kills + assists) / deaths).toFixed(2)}:1`;
}

export function csPerMinute(cs: number | null, durationSeconds: number | null) {
  return cs === null || !durationSeconds ? null : ((cs * 60) / durationSeconds).toFixed(1);
}

export function killParticipation(
  participant: ScoreboardParticipant,
  team: ScoreboardTeam | undefined,
) {
  if (participant.kills === null || participant.assists === null || team?.kills == null)
    return null;
  if (team.kills === 0) return participant.kills + participant.assists === 0 ? 0 : null;
  return Math.round(((participant.kills + participant.assists) / team.kills) * 100);
}

export function matchRelativeTime(startedAt: string, locale: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return formatter.format(-seconds, 'second');
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), 'hour');
  return formatter.format(-Math.floor(seconds / 86400), 'day');
}

export function matchDuration(duration: number | null) {
  return duration === null
    ? '—'
    : `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
}

const positionOrder: Record<string, number> = {
  TOP: 0,
  JUNGLE: 1,
  MIDDLE: 2,
  MID: 2,
  BOTTOM: 3,
  BOT: 3,
  UTILITY: 4,
  SUPPORT: 4,
};
export function sortScoreboardParticipants(participants: ScoreboardParticipant[]) {
  return [...participants].sort(
    (left, right) =>
      (positionOrder[left.position || ''] ?? 5) - (positionOrder[right.position || ''] ?? 5) ||
      left.id - right.id,
  );
}

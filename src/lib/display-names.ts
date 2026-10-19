import type { TFunction } from 'i18next';
import type { Player, RankEntry } from '../generated/contracts';
import { serverName } from './server-name';
import labels from '../i18n/locales/zh-CN/labels.json';

export const championIds = Object.keys(labels).filter(key => /^champion_\d+$/.test(key)).map(key => Number(key.slice('champion_'.length)));

export function championName(t: TFunction, id: number | null | undefined) {
  return id ? t(`labels.champion_${id}`, { defaultValue: t('labels.champion', { id }) }) : t('labels.unknown');
}

export function playerName(t: TFunction, player: Player | null | undefined) {
  return player?.displayName && player.displayName !== player.puuid && player.displayName !== player.playerKey ? player.displayName : t('labels.unknownPlayer');
}

export function codeName(t: TFunction, category: string, code: string | number | null | undefined) {
  return code == null || code === '' ? '—' : t(`labels.${category}_${code}`, { defaultValue: t('labels.unknown') });
}

export function queueName(t: TFunction, id: string | number | null | undefined) {
  return id == null || id === '' ? t('labels.queue_unknown') : t(`labels.queue_${id}`, { defaultValue: t('labels.queue_unknown') });
}

export function errorName(t: TFunction, code: string | null | undefined) {
  const key = code?.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() || 'network_unavailable';
  return t(`errors.${key}`, { defaultValue: t('errors.network_unavailable') });
}

export function positionName(t: TFunction, value: string | null | undefined) {
  const code = value?.toUpperCase();
  const aliases: Record<string, string> = { MID: 'MIDDLE', BOT: 'BOTTOM', SUPPORT: 'UTILITY' };
  return t(`matches.position_${aliases[code || ''] || code}`, { defaultValue: t('labels.unknown') });
}

export function groupName(t: TFunction, group: string) {
  const [queue, position, patch, rule] = group.split(':');
  return [queueName(t, queue), positionName(t, position), t('labels.patch', { version: patch && patch !== 'unknown' ? patch : t('labels.unknown') }), ...(rule ? [t('labels.ruleVersion', { version: rule })] : [])].join(' · ');
}

export function matchName(t: TFunction, key: string) {
  const split = key.lastIndexOf(':');
  const id = key.slice(split + 1);
  return split > 0 && /^\d+$/.test(id) ? `${serverName(t, key.slice(0, split))} · ${t('labels.matchNumber', { id })}` : t('labels.match');
}

export function rankName(t: TFunction, rank: RankEntry) {
  const division = /^[IV]{1,3}$/.test(rank.division || '') ? rank.division : '';
  return [queueName(t, rank.queue), codeName(t, 'rank', rank.tier?.toUpperCase()), division, t('labels.rankPoints', { points: rank.points ?? '—' })].filter(Boolean).join(' ');
}

export function skillName(t: TFunction, slot: number) {
  return t('labels.skill', { slot: ['Q', 'W', 'E', 'R'][slot - 1] || t('labels.unknown') });
}

export function spellName(t: TFunction, id: number) {
  return t(`labels.spell_${id}`, { defaultValue: t('labels.spell', { id }) });
}

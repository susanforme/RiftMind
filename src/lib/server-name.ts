import type { TFunction } from 'i18next';

export function serverName(t: TFunction, serverId: string | null | undefined): string {
  return serverId ? t(serverId, { ns: 'servers', defaultValue: serverId }) : '—';
}

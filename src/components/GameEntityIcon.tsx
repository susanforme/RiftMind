import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../app/runtime';
import type { ResourceKind } from '../generated/contracts';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
// The portrait catalogue is pinned with the existing champion-name catalogue.
export const portraitCatalogueVersion = '16.20.1';
export function GameEntityIcon({ kind, id, version, label, className = '' }: { kind: ResourceKind; id: number | null | undefined; version?: string | null; label: string; className?: string }) {
 const { i18n } = useTranslation(); const assetVersion = version && version !== 'unknown' ? version : portraitCatalogueVersion; const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
 const artwork = useQuery({ queryKey: ['game-entity-art', assetVersion, locale, kind, id], queryFn: () => transport.call('resolve_assets', { version: assetVersion, locale, championIds: kind === 'champion' ? [id!] : [], resourceIds: kind === 'champion' ? [] : [{ kind, id: id! }] }), enabled: !!id, staleTime: Infinity, retry: false });
 return <Avatar className={`size-8 shrink-0 rounded-md ${className}`} title={label}><AvatarImage src={artwork.data?.[0]?.reference || undefined} alt={label} className="object-cover" /><AvatarFallback className="rounded-md" aria-label={label}>—</AvatarFallback></Avatar>;
}
export function skillResourceId(championId: number | null | undefined, slot: number | null | undefined) { return championId && slot && slot >= 1 && slot <= 4 ? championId * 10 + slot : null; }

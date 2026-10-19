import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../app/runtime';
import type { ResourceKind } from '../generated/contracts';

// The portrait catalogue is pinned with the existing champion-name catalogue.
export const portraitCatalogueVersion = '16.20.1';

export function useGameEntityAsset(
  kind: ResourceKind,
  id: number | null | undefined,
  version?: string | null,
) {
  const { i18n } = useTranslation();
  const assetVersion = version && version !== 'unknown' ? version : portraitCatalogueVersion;
  const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  return useQuery({
    queryKey: ['game-entity-art', assetVersion, locale, kind, id],
    queryFn: () =>
      transport.call('resolve_assets', {
        version: assetVersion,
        locale,
        championIds: kind === 'champion' ? [id!] : [],
        resourceIds: kind === 'champion' ? [] : [{ kind, id: id! }],
      }),
    enabled: !!id,
    staleTime: Infinity,
    retry: false,
  });
}

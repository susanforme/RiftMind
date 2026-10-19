import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../app/runtime';
import { portraitCatalogueVersion } from './GameEntityIcon';
import type { ChampionSkin } from '../generated/contracts';

export function selectedChampionSkin(skins: ChampionSkin[], skinId: number | undefined) {
  return skins.find((skin) => skin.id === skinId) || skins.find((skin) => skin.isBase) || skins[0];
}

export function ChampionArtwork({
  skin,
  version,
  banner = false,
}: {
  skin: ChampionSkin | undefined;
  version: string | undefined;
  banner?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [failedReference, setFailedReference] = useState<string | null>(null);
  const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const assetVersion = version && version !== 'unknown' ? version : portraitCatalogueVersion;
  const artwork = useQuery({
    queryKey: ['champion-splash', assetVersion, locale, skin?.id],
    queryFn: () =>
      transport.call('resolve_assets', {
        version: assetVersion,
        locale,
        championIds: [],
        resourceIds: [{ kind: 'champion_splash', id: skin!.id }],
      }),
    enabled: !!skin,
    staleTime: Infinity,
    retry: false,
  });
  const reference = artwork.data?.[0]?.reference;
  if (!reference || reference === failedReference) return null;
  return (
    <div
      data-ui="champion-artwork"
      className={
        banner
          ? 'pointer-events-none absolute inset-y-0 right-0 w-full overflow-hidden'
          : 'relative mb-4 aspect-video overflow-hidden rounded-lg'
      }
    >
      <img
        src={reference}
        alt={t('matches.artworkLabel', { name: skin!.name })}
        className="h-full w-full object-cover object-[65%_30%]"
        onError={() => setFailedReference(reference)}
      />
      <div
        aria-hidden="true"
        className={
          banner
            ? 'absolute inset-0 bg-linear-to-r from-(--hero-mask) from-25% via-(--hero-mask)/85 via-50% to-(--hero-edge)'
            : 'absolute inset-0 bg-linear-to-t from-(--hero-mask)/60 to-(--hero-edge)'
        }
      />
    </div>
  );
}

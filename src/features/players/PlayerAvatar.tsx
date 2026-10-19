import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { portraitCatalogueVersion } from '../../components/GameEntityIcon';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import type { Player } from '../../generated/contracts';
import { cn } from '../../lib/utils';

export function PlayerAvatar({
  player,
  className,
}: {
  player: Player | undefined;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const iconId = player?.profileIconId;
  const icon = useQuery({
    queryKey: ['player-profile-icon', portraitCatalogueVersion, locale, iconId],
    queryFn: () =>
      transport.call('resolve_assets', {
        version: portraitCatalogueVersion,
        locale,
        championIds: [],
        resourceIds: [{ kind: 'profile_icon', id: iconId! }],
      }),
    enabled: iconId != null,
    staleTime: Infinity,
    retry: false,
  });
  const label = t('matches.playerIcon', { name: player?.displayName || t('common.defaultTab') });
  return (
    <div className="relative shrink-0 pb-2">
      <Avatar className={cn('size-20 border-2 border-primary/70 bg-muted', className)}>
        <AvatarImage src={icon.data?.[0]?.reference || undefined} alt={label} />
        <AvatarFallback aria-label={label}>
          {player?.displayName.slice(0, 2).toUpperCase() || '—'}
        </AvatarFallback>
      </Avatar>
      {player?.summonerLevel != null && player.summonerLevel > 0 && (
        <Badge
          data-ui="player-level"
          variant="outline"
          aria-label={t('matches.playerLevel', { level: player.summonerLevel })}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full border-primary bg-background px-2 text-xs text-foreground tabular-nums"
        >
          {player.summonerLevel}
        </Badge>
      )}
    </div>
  );
}

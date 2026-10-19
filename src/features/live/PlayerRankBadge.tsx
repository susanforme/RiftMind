import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import type { RankEntry } from '../../generated/contracts';
import { codeName, queueName } from '../../lib/display-names';
import { rankedTier, rankDivision } from './player-ranks';

const rankEmblems = import.meta.glob<string>('../../assets/ranks/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function RankEmblem({
  rank,
  large = false,
}: {
  rank: RankEntry | undefined;
  large?: boolean;
}) {
  const tier = rankedTier(rank);
  return (
    <Avatar className={`${large ? 'size-10' : 'size-6'} rounded-none`} aria-hidden="true">
      <AvatarImage
        src={tier ? rankEmblems[`../../assets/ranks/${tier.toLowerCase()}.png`] : undefined}
        alt=""
        className="object-contain"
      />
      <AvatarFallback className="rounded-none bg-transparent text-xs text-muted-foreground">
        —
      </AvatarFallback>
    </Avatar>
  );
}

export function PlayerRankBadge({
  rank,
  queue,
  unavailable = false,
}: {
  rank: RankEntry | undefined;
  queue: string;
  unavailable?: boolean;
}) {
  const { t } = useTranslation();
  const tier = rankedTier(rank);
  const label = unavailable
    ? t('scouting.unavailable')
    : tier
      ? codeName(t, 'rank', tier)
      : t('scouting.unranked');
  const division = rankDivision(rank);
  const accessibleLabel = `${queueName(t, queue)} · ${label}${division ? ` ${division}` : ''}`;
  return (
    <Badge
      data-ui="player-rank"
      variant="secondary"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="shrink-0 gap-0.5 rounded-md px-1 py-0 text-xs font-medium tabular-nums"
    >
      {tier && <RankEmblem rank={rank} />}
      <span className={tier ? 'hidden @min-[260px]/player:inline' : ''}>{label}</span>
      {division && <span>{division}</span>}
    </Badge>
  );
}

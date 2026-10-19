import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { ErrorNotice } from '../../components/ErrorNotice';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import type { LiveSeat } from '../../generated/contracts';
import { championName, playerName, positionName, spellName } from '../../lib/display-names';
import { MetricValue } from '../analysis/MetricValue';
import { FavoriteButton } from '../players/FavoriteButton';
import { useOpenPlayer } from '../players/useOpenPlayer';
import { PlayerAvatar } from '../players/PlayerAvatar';
import { PlayerRankBadge } from './PlayerRankBadge';
import { PlayerRanksHoverCard } from './PlayerRanksHoverCard';
import { rankForRoom, rankQueueForRoom } from './player-ranks';
import { LiveRecentMatches } from './LiveRecentMatches';

export function LivePlayerCard({
  seat,
  queueId,
  epoch,
  session,
  stale,
  metricScope,
}: {
  seat: LiveSeat;
  queueId: number | null;
  epoch: string;
  session: string;
  stale: boolean;
  metricScope: 'recent' | 'champion';
}) {
  const { t, i18n } = useTranslation();
  const openPlayer = useOpenPlayer();
  const navigate = useNavigate();
  const profile = useQuery({
    queryKey: ['player-profile', epoch, session, seat.player?.playerKey, queueId, seat.championId],
    queryFn: () =>
      transport.call('get_player_profile', {
        playerKey: seat.player!.playerKey,
        queueId,
        championId: seat.championId,
      }),
    enabled: !!seat.player && !stale,
    staleTime: seat.current ? 60000 : 0,
    gcTime: seat.current ? 300000 : 0,
    retry: false,
  });
  const championScope = metricScope === 'champion';
  const rank = rankForRoom(profile.data?.ranks || [], queueId);
  const rankLoading = profile.isFetching && !profile.data;
  const rankUnavailable = !!profile.data?.rankError || (!profile.data && !rankLoading);
  return (
    <Card
      data-ui="live-seat"
      data-current={seat.current}
      className="@container/player flex h-full flex-col gap-3 rounded-lg border-border bg-card p-3 data-[current=true]:border-primary data-[current=true]:ring-1 data-[current=true]:ring-primary/20"
    >
      <CardHeader className="gap-2 p-0">
        <div className="flex min-w-0 items-center justify-between gap-1">
          {seat.position && (
            <Badge variant="secondary" className="rounded-sm text-xs font-normal">
              {seat.position.toUpperCase() === 'FILL'
                ? t('scouting.fillPosition')
                : positionName(t, seat.position)}
            </Badge>
          )}
          {seat.current && (
            <Badge
              variant="outline"
              className="rounded-sm border-primary/30 px-1.5 py-0 text-xs font-medium text-primary"
            >
              {t('scouting.self')}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1 [&_button]:size-7 [&_button]:p-0">
            {!!seat.championId && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${championName(t, seat.championId)} · ${t('notebooks.titlePage')}`}
                title={t('notebooks.titlePage')}
                disabled={!seat.championId}
                onClick={() =>
                  void navigate({
                    to: '/notebooks',
                    search: { champion: seat.championId || undefined },
                  })
                }
              >
                <BookOpen aria-hidden="true" />
              </Button>
            )}
            {seat.player && <FavoriteButton playerKey={seat.player.playerKey} />}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <PlayerRanksHoverCard
            player={seat.player}
            ranks={profile.data?.ranks}
            queueId={queueId}
            loading={rankLoading}
            unavailable={rankUnavailable}
          >
            {seat.championId ? (
              <GameEntityIcon
                kind="champion"
                id={seat.championId}
                label={championName(t, seat.championId)}
                className="size-12 rounded-lg"
              />
            ) : (
              <PlayerAvatar player={seat.player || undefined} className="size-12" />
            )}
          </PlayerRanksHoverCard>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {seat.player ? (
                <Button
                  variant="link"
                  className="block h-auto min-w-0 flex-1 truncate p-0 text-left text-sm font-semibold text-foreground"
                  title={playerName(t, seat.player)}
                  onClick={() => openPlayer(seat.player!)}
                >
                  {playerName(t, seat.player)}
                </Button>
              ) : (
                <span className="text-sm font-semibold">{t('scouting.anonymous')}</span>
              )}
              {seat.player &&
                (rankLoading ? (
                  <Skeleton className="h-6 w-12 shrink-0" aria-label={t('scouting.currentRank')} />
                ) : (
                  <PlayerRankBadge
                    rank={rank}
                    queue={rankQueueForRoom(queueId)}
                    unavailable={rankUnavailable}
                  />
                ))}
            </div>
            <div className="mt-1 flex items-center justify-between gap-1">
              {!!seat.championId && (
                <span className="truncate text-xs text-muted-foreground">
                  {championName(t, seat.championId)}
                </span>
              )}
              {!!seat.spellIds.length && (
                <div className="flex shrink-0 gap-1" aria-label={t('scouting.spells')}>
                  {seat.spellIds.map((id, index) => (
                    <GameEntityIcon
                      key={`${index}:${id}`}
                      kind="spell"
                      id={id}
                      label={spellName(t, id)}
                      className="size-5 rounded-sm"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid flex-1 content-start gap-3 p-0">
        <ErrorNotice error={profile.error} />
        {profile.isFetching && !profile.data && (
          <Skeleton className="h-44" aria-label={t('common.loading')} />
        )}
        {profile.error && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void profile.refetch()}
            disabled={stale}
          >
            {t('common.retry')}
          </Button>
        )}
        {profile.data && (
          <div data-ui="profile-stats" className="grid gap-2.5 text-xs">
            <div className="rounded-md bg-muted/50 p-2">
              <div className="mb-1 text-muted-foreground">
                {t(championScope ? 'scouting.thisChampion' : 'scouting.recent', {
                  count: championScope ? profile.data.championGames : profile.data.games,
                })}
              </div>
              <dl className="grid grid-cols-2 gap-2">
                <div className="grid gap-0.5">
                  <dt className="text-muted-foreground">{t('scouting.winRate')}</dt>
                  <dd className="text-lg font-semibold">
                    <MetricValue
                      metric={championScope ? profile.data.championWinRate : profile.data.winRate}
                      ratio
                      showSamples={false}
                    />
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-muted-foreground">KDA</dt>
                  <dd className="text-lg font-semibold">
                    <MetricValue
                      metric={championScope ? profile.data.championKda : profile.data.kda}
                      showSamples={false}
                    />
                  </dd>
                </div>
              </dl>
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">{t('scouting.commonChampions')}</span>
              <div
                className="flex min-h-7 flex-wrap items-center gap-2"
                aria-label={t('scouting.commonChampions')}
              >
                {profile.data.champions.slice(0, 3).map((champion) => (
                  <span
                    className="inline-flex items-center gap-1 tabular-nums"
                    key={champion.championId}
                  >
                    <GameEntityIcon
                      kind="champion"
                      id={champion.championId}
                      label={championName(t, champion.championId)}
                      className="size-7"
                    />
                    <span aria-label={t('scouting.championGames', { count: champion.games })}>
                      {champion.games}
                    </span>
                  </span>
                ))}
                {!profile.data.champions.length && (
                  <span className="text-muted-foreground">{t('scouting.empty')}</span>
                )}
              </div>
            </div>
            <time dateTime={profile.data.collectedAt} className="sr-only">
              {new Date(profile.data.collectedAt).toLocaleString(i18n.language)}
            </time>
            {seat.player && (
              <LiveRecentMatches
                key={`${epoch}:${session}:${seat.player.playerKey}:${queueId}`}
                player={seat.player}
                queueId={queueId}
                epoch={epoch}
                session={session}
                enabled={!stale}
                current={seat.current}
              />
            )}
          </div>
        )}
        {!profile.data && !profile.isFetching && !profile.error && (
          <div className="grid min-h-44 place-items-center rounded-md bg-muted/30 text-xs text-muted-foreground">
            {t(stale ? 'scouting.stale' : 'scouting.anonymous')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

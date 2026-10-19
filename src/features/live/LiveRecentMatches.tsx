import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { ErrorNotice } from '../../components/ErrorNotice';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/skeleton';
import type { MatchSummary, Player } from '../../generated/contracts';
import { championName, matchName, playerName, queueName } from '../../lib/display-names';
import { matchOutcomeClasses } from '../../lib/match-outcome';
import { MatchHistoryRow } from '../matches/MatchHistoryRow';

export function LiveRecentMatches({
  player,
  queueId,
  epoch,
  session,
  enabled,
  current,
}: {
  player: Player;
  queueId: number | null;
  epoch: string;
  session: string;
  enabled: boolean;
  current: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [inspectedMatch, setInspectedMatch] = useState<MatchSummary | null>(null);
  const history = useQuery({
    queryKey: ['live-recent-matches', epoch, session, player.playerKey, queueId],
    queryFn: () =>
      transport.call('get_player_overview', {
        playerKey: player.playerKey,
        queueId,
        days: null,
      }),
    enabled,
    staleTime: current ? 60000 : 0,
    gcTime: current ? 300000 : 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const matches = [...(history.data?.matches || [])]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, 10);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <section
      className="grid min-w-0 gap-1.5 border-t border-border pt-2.5"
      aria-label={t('scouting.recentMatches')}
    >
      <span className="text-xs text-muted-foreground">{t('scouting.recentMatches')}</span>
      <ErrorNotice
        error={
          history.error || (history.data?.historyError ? { code: history.data.historyError } : null)
        }
      />
      {history.isFetching && !history.data ? (
        <Skeleton className="h-48" aria-label={t('common.loading')} />
      ) : (
        <div className="grid max-h-64 gap-1 overflow-y-auto overscroll-contain pr-1">
          {matches.map((match) => (
            <Button
              key={match.matchKey}
              variant="ghost"
              data-ui="live-recent-match"
              aria-label={`${t('matches.details')} ${matchName(t, match.matchKey)}`}
              className={`h-auto min-h-11 w-full justify-start gap-2 rounded-md border-l-2 border-(--outcome) bg-(--row-bg) px-2 py-1.5 text-left hover:bg-(--row-bg) hover:brightness-95 ${matchOutcomeClasses[match.outcome]}`}
              onClick={() => setInspectedMatch(match)}
            >
              <GameEntityIcon
                kind="champion"
                id={match.championId}
                version={match.version}
                label={championName(t, match.championId)}
                className="size-8 shrink-0 rounded-md"
              />
              <span className="grid min-w-0 flex-1 gap-0.5 text-xs font-normal">
                <span className="truncate">{queueName(t, match.queueId)}</span>
                <span className="flex flex-wrap gap-x-1.5 text-[11px] text-muted-foreground">
                  <time dateTime={match.startedAt}>
                    {dateFormat.format(new Date(match.startedAt))}
                  </time>
                  <span className="text-(--outcome)">{t(`matches.${match.outcome}`)}</span>
                </span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums">
                {match.kills ?? '—'} / {match.deaths ?? '—'} / {match.assists ?? '—'}
              </span>
            </Button>
          ))}
          {!matches.length && !history.error && !history.isPending && (
            <span className="py-4 text-center text-xs text-muted-foreground">
              {t('scouting.empty')}
            </span>
          )}
        </div>
      )}
      {history.error && (
        <Button
          variant="outline"
          size="sm"
          disabled={!enabled}
          onClick={() => void history.refetch()}
        >
          {t('common.retry')}
        </Button>
      )}
      <Dialog
        open={!!inspectedMatch}
        onOpenChange={(open) => {
          if (!open) setInspectedMatch(null);
        }}
      >
        {inspectedMatch && (
          <DialogContent
            className="w-[calc(100%-2rem)] max-w-[1440px] min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-3 sm:p-4"
            closeLabel={t('common.dismiss')}
            aria-describedby={undefined}
          >
            <DialogHeader className="pr-8 text-left">
              <DialogTitle className="truncate">
                {playerName(t, player)} · {t('matches.details')}
              </DialogTitle>
            </DialogHeader>
            <MatchHistoryRow
              key={inspectedMatch.matchKey}
              match={inspectedMatch}
              presentation="details"
              readOnly={!history.data?.isSelf}
              workspaceEpoch={epoch}
            />
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

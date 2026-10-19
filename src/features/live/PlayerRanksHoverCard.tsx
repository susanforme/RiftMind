import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../components/ui/hover-card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '../../components/ui/table';
import type { Player, RankEntry } from '../../generated/contracts';
import { codeName, playerName, queueName } from '../../lib/display-names';
import { allRankQueues, rankQueueForRoom, rankedTier, rankDivision } from './player-ranks';
import { RankEmblem } from './PlayerRankBadge';

export function PlayerRanksHoverCard({
  children,
  player,
  ranks,
  queueId,
  loading,
  unavailable,
}: {
  children: ReactNode;
  player: Player | null;
  ranks: RankEntry[] | undefined;
  queueId: number | null;
  loading: boolean;
  unavailable: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const contentId = useId();
  const currentQueue = rankQueueForRoom(queueId);
  function closeRanks() {
    setPinned(false);
    setOpen(false);
  }
  if (!player) return children;
  return (
    <HoverCard
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || !pinned) setOpen(nextOpen);
      }}
      openDelay={180}
      closeDelay={100}
    >
      <HoverCardTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto shrink-0 rounded-lg p-0 hover:bg-transparent"
          aria-label={t('scouting.viewRanks', { name: playerName(t, player) })}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onClick={() => {
            setPinned(!pinned);
            setOpen(!pinned);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') closeRanks();
          }}
        >
          {children}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        id={contentId}
        role="dialog"
        aria-label={t('scouting.viewRanks', { name: playerName(t, player) })}
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        onEscapeKeyDown={closeRanks}
        onPointerDownOutside={closeRanks}
        className="w-88 max-w-[calc(100vw-2rem)] overflow-hidden p-0 text-foreground"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="min-w-0 break-words text-sm font-semibold">{playerName(t, player)}</span>
          <span className="text-xs text-muted-foreground">{t('scouting.allRanks')}</span>
        </div>
        {loading ? (
          <Skeleton className="m-4 h-24" aria-label={t('common.loading')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4 text-xs">{t('matches.queue')}</TableHead>
                <TableHead className="text-xs">{t('scouting.currentRank')}</TableHead>
                <TableHead className="pr-4 text-right text-xs">
                  {t('scouting.leaguePoints')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allRankQueues(ranks || []).map(({ queue, rank }) => {
                const tier = rankedTier(rank);
                const selected = queue === currentQueue;
                return (
                  <TableRow
                    key={queue}
                    data-current-queue={selected}
                    className="data-[current-queue=true]:bg-accent/40"
                  >
                    <TableCell className="pl-4 text-xs">{queueName(t, queue)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                        {tier && <RankEmblem rank={rank} large />}
                        <span>
                          {unavailable
                            ? t('scouting.unavailable')
                            : tier
                              ? `${codeName(t, 'rank', tier)} ${rankDivision(rank)}`.trim()
                              : t('scouting.unranked')}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="pr-4 text-right text-xs tabular-nums">
                      {tier && !unavailable ? (rank?.points ?? '—') : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

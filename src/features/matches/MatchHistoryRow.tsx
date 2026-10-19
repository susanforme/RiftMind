import { Check, ChevronDown } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import { Skeleton } from '../../components/ui/skeleton';
import type { MatchSummary } from '../../generated/contracts';
import { championName, matchName, queueName } from '../../lib/display-names';
import { matchOutcomeClasses } from '../../lib/match-outcome';
import { ScoreboardItems, ScoreboardSpells } from './ScoreboardLoadout';
import { MatchScoreboard } from './MatchScoreboard';
import { useMatchScoreboard } from './useMatchScoreboard';
import { useMatchDetailsMotion } from './useMatchDetailsMotion';
import {
  csPerMinute,
  formatMatchKda,
  killParticipation,
  matchDuration,
  matchRelativeTime,
  sortScoreboardParticipants,
} from './match-scoreboard-formatters';

export const MatchHistoryRow = memo(function MatchHistoryRow({
  match,
  active = false,
  selected = false,
  disabled = false,
  presentation = 'history',
  readOnly = false,
  keepDetailsMounted = false,
  onSelect,
  onInspect,
  workspaceEpoch,
}: {
  match: MatchSummary;
  active?: boolean;
  selected?: boolean;
  disabled?: boolean;
  presentation?: 'history' | 'details';
  readOnly?: boolean;
  keepDetailsMounted?: boolean;
  onSelect?: (matchKey: string) => void;
  onInspect?: (matchKey: string) => void;
  workspaceEpoch?: string;
}) {
  const { t, i18n } = useTranslation();
  const expanded = presentation === 'details' || active;
  const detailsMotion = useMatchDetailsMotion(expanded, keepDetailsMounted);
  const { row, scoreboard, fetchDetails, task, loading } = useMatchScoreboard(
    match,
    expanded,
    workspaceEpoch,
    readOnly,
  );
  const board = scoreboard.data;
  const participant = board?.participants.find((participant) => participant.id === board.targetId);
  const team = board?.teams.find((team) => team.id === participant?.teamId);
  const participation = participant ? killParticipation(participant, team) : null;
  const incomplete =
    !board ||
    !participant ||
    board.teams.length < 2 ||
    board.participants.some((member) => member.kills === null || member.level === null);
  const summary = (
    <>
      <span className="grid self-stretch content-center gap-1 text-xs text-muted-foreground [grid-area:1/1/3/2] max-[650px]:[grid-area:1/1/2/2]">
        <strong className="font-semibold text-(--outcome)">{queueName(t, match.queueId)}</strong>
        <time
          dateTime={match.startedAt}
          title={new Date(match.startedAt).toLocaleString(i18n.language)}
        >
          {matchRelativeTime(match.startedAt, i18n.language)}
        </time>
        <span className="my-1 h-px w-12 bg-(--outcome)/25" />
        <strong className="text-sm text-(--outcome)">{t(`matches.${match.outcome}`)}</strong>
        <span className="tabular-nums">{matchDuration(match.duration)}</span>
      </span>
      <span className="col-start-2 row-start-1 flex items-center gap-2">
        <span className="relative shrink-0">
          <GameEntityIcon
            kind="champion"
            id={match.championId}
            version={match.version}
            label={championName(t, match.championId)}
            className="size-14 rounded-full max-[650px]:size-10"
          />
          {participant?.level != null && (
            <Badge
              variant="secondary"
              className="absolute -bottom-1 -right-1 rounded-full px-1.5 text-xs"
            >
              {participant.level}
            </Badge>
          )}
        </span>
        {participant && (
          <ScoreboardSpells participant={participant} version={match.version} interactive={false} />
        )}
      </span>
      <span className="col-start-3 row-start-1 grid gap-1 text-center tabular-nums">
        <strong className="whitespace-nowrap text-xl font-semibold text-foreground max-[650px]:text-base">
          {match.kills ?? '—'} <span className="font-normal text-muted-foreground">/</span>{' '}
          <span className="text-(--loss)">{match.deaths ?? '—'}</span>{' '}
          <span className="font-normal text-muted-foreground">/</span> {match.assists ?? '—'}
        </strong>
        <span className="text-xs text-muted-foreground">
          {formatMatchKda(match.kills, match.deaths, match.assists)} KDA
        </span>
      </span>
      <span className="col-start-4 row-start-1 grid gap-1 border-l border-border/70 pl-4 text-xs text-muted-foreground max-[650px]:hidden">
        {participation !== null && (
          <span>
            {t('matches.killParticipation')}{' '}
            <strong className="font-medium text-foreground">{participation}%</strong>
          </span>
        )}
        <span>
          CS {match.cs ?? '—'}{' '}
          <span className="tabular-nums">
            ({csPerMinute(match.cs, match.duration) ?? '—'}
            {t('matches.perMinute')})
          </span>
        </span>
        {participant?.visionScore != null && (
          <span>
            {t('matches.vision')} {participant.visionScore}
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-3 [grid-area:2/2/3/5] max-[650px]:[grid-area:2/1/3/4]">
        <ScoreboardItems
          items={participant?.items || match.items}
          roleItem={participant?.roleItem}
          version={match.version}
          interactive={false}
        />
        {!!participant?.multiKill && participant.multiKill >= 2 && (
          <Badge variant="secondary" className="rounded-full bg-(--loss-bg) text-(--loss)">
            {t(`matches.multiKill_${Math.min(participant.multiKill, 5)}`)}
          </Badge>
        )}
      </span>
      <span className="col-start-5 row-start-1 row-span-2 hidden min-w-0 grid-cols-2 gap-3 min-[1200px]:grid">
        {board?.teams.map((rosterTeam) => (
          <span key={rosterTeam.id} className="grid min-w-0 gap-1">
            {sortScoreboardParticipants(
              board.participants.filter((member) => member.teamId === rosterTeam.id),
            ).map((member) => (
              <span
                key={member.id}
                className={`flex min-w-0 items-center gap-1.5 text-[11px] ${member.id === board.targetId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                title={member.displayName || championName(t, member.championId)}
              >
                <GameEntityIcon
                  kind="champion"
                  id={member.championId}
                  version={match.version}
                  label={championName(t, member.championId)}
                  className="size-4 rounded-sm"
                />
                <span className="truncate">
                  {member.displayName?.split('#')[0] || championName(t, member.championId)}
                </span>
              </span>
            ))}
          </span>
        ))}
      </span>
    </>
  );
  const summaryClassName =
    'grid h-auto min-h-36 min-w-0 flex-1 grid-cols-[92px_100px_112px_minmax(96px,1fr)_20px] grid-rows-[auto_auto] items-center gap-x-4 gap-y-2 rounded-none px-2 py-4 text-left font-normal whitespace-normal hover:bg-transparent hover:text-foreground min-[1200px]:grid-cols-[108px_104px_124px_minmax(110px,1fr)_minmax(160px,1.1fr)_20px] max-[650px]:grid-cols-[76px_80px_minmax(80px,1fr)_16px] max-[650px]:gap-x-2';
  return (
    <Collapsible
      className="min-w-0"
      open={expanded}
      onOpenChange={() => onInspect?.(match.matchKey)}
    >
      <Card
        ref={row}
        data-ui="match-row"
        data-selected={expanded}
        className={`relative overflow-hidden rounded-lg border-0 bg-(--row-bg) shadow-none ${matchOutcomeClasses[match.outcome]}`}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-(--outcome)" />
        <div className="flex items-center gap-1 pl-3 pr-2 sm:gap-2 sm:pl-4">
          {presentation === 'history' && onSelect && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t('training.selectMatch')} ${matchName(t, match.matchKey)}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect?.(match.matchKey)}
              className="size-6 shrink-0 rounded-md border border-border/70 p-0 text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {selected ? (
                <Check aria-hidden="true" />
              ) : (
                <span className="size-2 rounded-sm border border-current" aria-hidden="true" />
              )}
            </Button>
          )}
          {presentation === 'details' ? (
            <div className={summaryClassName}>{summary}</div>
          ) : (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                aria-pressed={active}
                aria-label={`${t('matches.details')} ${matchName(t, match.matchKey)}`}
                className={summaryClassName}
              >
                {summary}
                <ChevronDown
                  aria-hidden="true"
                  className={`col-start-5 row-start-1 row-span-2 text-(--outcome) transition-transform duration-250 ease-out motion-reduce:transition-none min-[1200px]:col-start-6 max-[650px]:col-start-4 ${active ? 'rotate-180' : ''}`}
                />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
        <div
          data-ui="match-details-content"
          data-state={expanded ? 'open' : 'closed'}
          aria-hidden={!expanded}
          inert={!expanded}
          className="overflow-hidden [contain:layout_paint] [overflow-anchor:none] transition-[height] duration-250 ease-out data-[state=closed]:duration-180 data-[state=closed]:ease-in motion-reduce:transition-none"
          style={{ height: presentation === 'details' ? 'auto' : detailsMotion.height }}
        >
          <CollapsibleContent forceMount>
            {detailsMotion.mounted && (
              <div
                ref={detailsMotion.contentRef}
                className={`flow-root transform-gpu transition-opacity duration-150 motion-reduce:transition-none ${expanded ? 'opacity-100' : 'opacity-0'}`}
              >
                <ErrorNotice
                  error={scoreboard.error || fetchDetails.error || task.error || task.data?.error}
                />
                {scoreboard.isLoading ? (
                  <Skeleton className="m-4 h-60" />
                ) : (
                  board && (
                    <MatchScoreboard scoreboard={board} match={match} allowReview={!readOnly} />
                  )
                )}
                {!scoreboard.isLoading && incomplete && (
                  <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                    <span>{t('matches.dataMissing')}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loading || scoreboard.isFetching}
                      onClick={() => (readOnly ? void scoreboard.refetch() : fetchDetails.mutate())}
                    >
                      {t(loading ? 'common.loading' : 'matches.loadDetails')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Card>
    </Collapsible>
  );
});

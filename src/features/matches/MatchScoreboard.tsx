import { lazy, memo, Suspense, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Skeleton } from '../../components/ui/skeleton';
import type {
  MatchScoreboard as Scoreboard,
  MatchSummary,
  ScoreboardParticipant,
} from '../../generated/contracts';
import { championName, positionName } from '../../lib/display-names';
import { ChartBoundary } from '../review/ChartBoundary';
import { useOpenPlayer } from '../players/useOpenPlayer';
import { ScoreboardItems, ScoreboardSpells } from './ScoreboardLoadout';
import {
  csPerMinute,
  formatMatchKda,
  killParticipation,
  scoreboardTeamName,
  sortScoreboardParticipants,
} from './match-scoreboard-formatters';
const TeamDamageChart = lazy(() => import('./MatchTeamComparisonChart'));

export const MatchScoreboard = memo(function MatchScoreboard({
  scoreboard,
  match,
  allowReview = true,
}: {
  scoreboard: Scoreboard;
  match: MatchSummary;
  allowReview?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const openPlayer = useOpenPlayer();
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const format = (value: number | null) => (value === null ? '—' : numberFormat.format(value));
  const participants = useMemo(
    () => sortScoreboardParticipants(scoreboard.participants),
    [scoreboard.participants],
  );
  const identityContent = (participant: ScoreboardParticipant) => (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="relative shrink-0">
        <GameEntityIcon
          kind="champion"
          id={participant.championId}
          version={match.version}
          label={championName(t, participant.championId)}
          className="size-11 rounded-full"
        />
        {participant.level !== null && (
          <Badge
            variant="secondary"
            className="absolute -bottom-1 -right-1 rounded-full px-1 text-[10px]"
          >
            {participant.level}
          </Badge>
        )}
      </span>
      <span className="grid min-w-0 gap-1">
        <span
          className="max-w-40 truncate font-medium"
          title={participant.displayName || undefined}
        >
          {participant.displayName || championName(t, participant.championId)}
        </span>
        <span className="text-xs text-muted-foreground">
          {positionName(t, participant.position)}
        </span>
      </span>
    </span>
  );
  const identity = (participant: ScoreboardParticipant) => (
    <span className="flex items-center gap-2.5">
      <ScoreboardSpells participant={participant} version={match.version} />
      {participant.playerKey ? (
        <Button
          variant="ghost"
          className="-m-1 h-auto max-w-full justify-start p-1 text-left font-normal text-foreground whitespace-normal"
          aria-label={`${participant.displayName || championName(t, participant.championId)} · ${t('players.title')}`}
          onClick={() => openPlayer({ playerKey: participant.playerKey! })}
        >
          {identityContent(participant)}
        </Button>
      ) : (
        identityContent(participant)
      )}
    </span>
  );
  return (
    <div
      data-ui="match-scoreboard"
      className="min-w-0 border-t border-border bg-background/70 p-3 sm:p-4"
    >
      <Tabs defaultValue="overview" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <TabsList className="h-9">
            <TabsTrigger value="overview">{t('matches.overview')}</TabsTrigger>
            <TabsTrigger value="damage">{t('matches.teamDamage')}</TabsTrigger>
            <TabsTrigger value="items">{t('matches.items')}</TabsTrigger>
          </TabsList>
          {allowReview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void navigate({
                  to: '/matches/$matchKey/review',
                  params: { matchKey: match.matchKey },
                  search: { player: match.playerKey },
                })
              }
            >
              {t('review.open')}
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
        <TabsContent value="overview" className="mt-0 space-y-4">
          {scoreboard.teams.map((team) => (
            <div key={team.id} className="overflow-hidden rounded-md border border-border">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
                <strong
                  className={
                    team.win === true
                      ? 'text-(--win)'
                      : team.win === false
                        ? 'text-(--loss)'
                        : 'text-foreground'
                  }
                >
                  {t(
                    team.win === true
                      ? 'matches.win'
                      : team.win === false
                        ? 'matches.loss'
                        : 'matches.unknown',
                  )}{' '}
                  · {scoreboardTeamName(t, team.id)}
                </strong>
                <span>
                  {t('matches.teamKills')} {format(team.kills)}
                </span>
                <span>
                  {t('matches.gold')} {format(team.gold)}
                </span>
                {(
                  [
                    ['barons', team.barons],
                    ['dragons', team.dragons],
                    ['towers', team.towers],
                    ['inhibitors', team.inhibitors],
                    ['riftHeralds', team.riftHeralds],
                    ['voidGrubs', team.voidGrubs],
                  ] as const
                )
                  .filter(([, value]) => value !== null)
                  .map(([label, value]) => (
                    <span key={label}>
                      {t(`matches.${label}`)} {value}
                    </span>
                  ))}
              </div>
              <Table className="min-w-[880px] text-xs">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-64">{t('matches.player')}</TableHead>
                    <TableHead>KDA</TableHead>
                    <TableHead>
                      {t('matches.damage')} / {t('matches.damageTaken')}
                    </TableHead>
                    <TableHead>{t('matches.vision')}</TableHead>
                    <TableHead>CS</TableHead>
                    <TableHead>{t('matches.items')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {participants
                    .filter((participant) => participant.teamId === team.id)
                    .map((participant) => {
                      const participation = killParticipation(participant, team);
                      return (
                        <TableRow
                          key={participant.id}
                          data-current={participant.id === scoreboard.targetId}
                          className="data-[current=true]:bg-accent/70"
                        >
                          <TableCell>{identity(participant)}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            <strong>
                              {participant.kills ?? '—'} /{' '}
                              <span className="text-(--loss)">{participant.deaths ?? '—'}</span> /{' '}
                              {participant.assists ?? '—'}
                            </strong>
                            <div className="mt-1 text-muted-foreground">
                              {formatMatchKda(
                                participant.kills,
                                participant.deaths,
                                participant.assists,
                              )}
                              {participation !== null && ` · ${participation}%`}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            <span>{format(participant.damage)}</span>
                            <span className="mx-1 text-muted-foreground">/</span>
                            <span className="text-muted-foreground">
                              {format(participant.damageTaken)}
                            </span>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <strong>{participant.visionScore ?? '—'}</strong>
                            <div
                              className="mt-1 text-muted-foreground"
                              title={t('matches.wardBreakdown')}
                            >
                              {participant.wardsPlaced ?? '—'} / {participant.wardsKilled ?? '—'} /{' '}
                              {participant.controlWards ?? '—'}
                            </div>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <strong>{participant.cs ?? '—'}</strong>
                            <div className="mt-1 whitespace-nowrap text-muted-foreground">
                              {csPerMinute(participant.cs, match.duration) ?? '—'}
                              {t('matches.perMinute')}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ScoreboardItems
                              items={participant.items}
                              roleItem={participant.roleItem}
                              version={match.version}
                              compact
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="damage" className="mt-0">
          <ChartBoundary fallback={t('matches.dataMissing')}>
            <Suspense fallback={<Skeleton className="h-96 w-full" />}>
              <TeamDamageChart
                participants={participants}
                teams={scoreboard.teams}
                version={match.version}
              />
            </Suspense>
          </ChartBoundary>
        </TabsContent>
        <TabsContent value="items" className="mt-0 grid gap-2 md:grid-cols-2">
          {scoreboard.teams.map((team) => (
            <div key={team.id} className="min-w-0 rounded-md border border-border p-3">
              <h4 className="mb-3 text-sm font-semibold">{scoreboardTeamName(t, team.id)}</h4>
              {participants
                .filter((participant) => participant.teamId === team.id)
                .map((participant) => (
                  <div
                    key={participant.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 py-3 first:border-0"
                  >
                    {identity(participant)}
                    <ScoreboardItems
                      items={participant.items}
                      roleItem={participant.roleItem}
                      version={match.version}
                      compact
                    />
                  </div>
                ))}
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
});

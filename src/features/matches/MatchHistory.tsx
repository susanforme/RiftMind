import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, ChevronRight, Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import type { MatchSummary, ChampionSkin } from '../../generated/contracts';
import {
  championName,
  codeName,
  errorName,
  matchName,
  positionName,
  queueName,
} from '../../lib/display-names';
import { matchOutcomeClasses } from '../../lib/match-outcome';
import { ChampionArtwork } from '../../components/ChampionArtwork';

export function groupMatchesByDate(matches: MatchSummary[], locale: string) {
  const groups = new Map<string, MatchSummary[]>();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  for (const match of matches) {
    const date = dateFormatter.format(new Date(match.startedAt));
    const group = groups.get(date) || [];
    group.push(match);
    groups.set(date, group);
  }
  return [...groups].map(([date, matches]) => ({ date, matches }));
}

export function recentMatchStats(matches: MatchSummary[]) {
  const wins = matches.filter((match) => match.outcome === 'win').length;
  const losses = matches.filter((match) => match.outcome === 'loss').length;
  const complete = matches.filter(
    (match) => match.kills !== null && match.deaths !== null && match.assists !== null,
  );
  const kills = complete.reduce((total, match) => total + match.kills!, 0);
  const deaths = complete.reduce((total, match) => total + match.deaths!, 0);
  const assists = complete.reduce((total, match) => total + match.assists!, 0);
  return {
    wins,
    losses,
    winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : null,
    kda: complete.length ? ((kills + assists) / Math.max(1, deaths)).toFixed(1) : null,
  };
}

function MatchItems({ match, large = false }: { match: MatchSummary; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1" aria-label={t('matches.items')}>
      {Array.from({ length: 6 }, (_, index) => match.items[index] || 0).map((id, index) => (
        <GameEntityIcon
          key={`${index}:${id}`}
          kind="item"
          id={id}
          version={match.version}
          label={id ? t('labels.item', { id }) : t('matches.emptyItem')}
          className={large ? 'size-10 rounded-sm' : 'size-6 rounded-sm'}
        />
      ))}
    </div>
  );
}

export function MatchHistoryRow({
  match,
  active,
  selected,
  disabled,
  onSelect,
  onInspect,
}: {
  match: MatchSummary;
  active: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onInspect: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Card
      data-ui="match-row"
      data-selected={active}
      className={`relative flex min-h-24 items-center gap-2 rounded-lg border border-transparent bg-transparent p-2 shadow-none transition-colors hover:bg-accent/40 data-[selected=true]:border-primary/70 data-[selected=true]:bg-accent/60 ${matchOutcomeClasses[match.outcome]}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-4 left-0 w-0.5 rounded-full bg-(--outcome)"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${t('training.selectMatch')} ${matchName(t, match.matchKey)}`}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
        className="size-7 shrink-0 rounded-md border border-border text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
      >
        {selected ? (
          <Check aria-hidden="true" />
        ) : (
          <span className="size-2 rounded-sm border border-current" aria-hidden="true" />
        )}
      </Button>
      <Button
        variant="ghost"
        onClick={onInspect}
        aria-pressed={active}
        aria-label={`${t('matches.details')} ${matchName(t, match.matchKey)}`}
        className="grid h-auto min-w-0 flex-1 grid-cols-[48px_minmax(88px,1fr)_92px_16px] items-center gap-3 rounded-none p-1 text-left whitespace-normal hover:bg-transparent hover:text-foreground min-[1500px]:grid-cols-[48px_minmax(88px,1fr)_92px_164px_52px_16px]"
      >
        <GameEntityIcon
          kind="champion"
          id={match.championId}
          version={match.version}
          label={championName(t, match.championId)}
          className="row-span-2 size-12 rounded-full min-[1500px]:row-span-1"
        />
        <span className="grid min-w-0 gap-1">
          <strong className="truncate text-[14px] text-foreground">
            {championName(t, match.championId)}
          </strong>
          <span className="truncate text-xs text-muted-foreground">
            {queueName(t, match.queueId)}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-(--outcome)">{t(`matches.${match.outcome}`)}</span>
            <span>
              {match.duration == null
                ? '—'
                : `${Math.floor(match.duration / 60)}:${String(match.duration % 60).padStart(2, '0')}`}
            </span>
          </span>
        </span>
        <span className="grid gap-1 text-center tabular-nums">
          <strong className="whitespace-nowrap text-base font-semibold text-foreground">
            {match.kills ?? '—'} <span className="text-muted-foreground">/</span>{' '}
            <span className="text-(--loss)">{match.deaths ?? '—'}</span>{' '}
            <span className="text-muted-foreground">/</span> {match.assists ?? '—'}
          </strong>
          <span className="text-xs text-muted-foreground">
            {t('matches.cs')} {match.cs ?? '—'}
          </span>
        </span>
        <span className="col-span-2 col-start-2 row-start-2 min-[1500px]:col-span-1 min-[1500px]:col-start-auto min-[1500px]:row-start-auto">
          <MatchItems match={match} />
        </span>
        <time
          dateTime={match.startedAt}
          className="hidden text-right text-xs text-muted-foreground tabular-nums min-[1500px]:block"
        >
          {new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
            new Date(match.startedAt),
          )}
        </time>
        <ChevronRight aria-hidden="true" className="text-muted-foreground" />
      </Button>
    </Card>
  );
}

export function MatchDetails({
  match,
  skin,
  workspaceEpoch,
}: {
  match: MatchSummary;
  skin?: ChampionSkin;
  workspaceEpoch: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const review = useQuery({
    queryKey: ['review-data', workspaceEpoch, match.matchKey, match.playerKey, undefined],
    queryFn: () =>
      transport.call('get_match_review_data', {
        playerKey: match.playerKey,
        matchKey: match.matchKey,
        inputRevision: null,
        reportId: null,
      }),
    enabled: !!workspaceEpoch,
    retry: false,
  });
  const participant = review.data?.input?.context.participants.find(
    (participant) => participant.id === review.data?.input?.context.targetId,
  );
  return (
    <Card
      data-ui="match-details"
      aria-label={t('matches.details')}
      className={`overflow-hidden p-5 ${matchOutcomeClasses[match.outcome]}`}
    >
      <div className="mb-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <time dateTime={match.startedAt}>
          {new Intl.DateTimeFormat(i18n.language, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(match.startedAt))}
        </time>
        <span>{match.version}</span>
      </div>
      <ChampionArtwork skin={skin} version={match.version} />
      <div className="flex items-center gap-4">
        <GameEntityIcon
          kind="champion"
          id={match.championId}
          version={match.version}
          label={championName(t, match.championId)}
          className="size-20 rounded-xl"
        />
        <div className="grid min-w-0 gap-1">
          <strong className="text-lg font-semibold">{championName(t, match.championId)}</strong>
          <span className="text-sm font-semibold text-(--outcome)">
            {t(`matches.${match.outcome}`)}
          </span>
          <span className="text-xs text-muted-foreground">
            {queueName(t, match.queueId)} · {positionName(t, match.position)}
          </span>
        </div>
      </div>
      <div className="my-5 flex items-end justify-between gap-3">
        <strong className="text-2xl font-semibold tabular-nums">
          {match.kills ?? '—'} <span className="text-muted-foreground">/</span>{' '}
          <span className="text-(--loss)">{match.deaths ?? '—'}</span>{' '}
          <span className="text-muted-foreground">/</span> {match.assists ?? '—'}
        </strong>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock3 size={14} aria-hidden="true" />
          {match.duration == null
            ? '—'
            : `${Math.floor(match.duration / 60)}:${String(match.duration % 60).padStart(2, '0')}`}
        </span>
      </div>
      <MatchItems match={match} large />
      <Button
        className="mt-5 h-10 w-full"
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
      <div className="mt-5 grid grid-cols-3 divide-x divide-border border-y border-border py-4 text-center">
        <div className="grid gap-1">
          <strong className="text-lg tabular-nums">{match.cs ?? '—'}</strong>
          <span className="text-xs text-muted-foreground">{t('matches.cs')}</span>
        </div>
        <div className="grid gap-1">
          <strong className="text-lg tabular-nums">
            {participant?.gold == null
              ? '—'
              : new Intl.NumberFormat(i18n.language, {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(participant.gold)}
          </strong>
          <span className="text-xs text-muted-foreground">{t('matches.gold')}</span>
        </div>
        <div className="grid gap-1">
          <strong className="text-lg tabular-nums">
            {participant?.damage == null
              ? '—'
              : new Intl.NumberFormat(i18n.language, {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(participant.damage)}
          </strong>
          <span className="text-xs text-muted-foreground">{t('matches.damage')}</span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{t(`review.list_${match.reviewState || 'missing'}`)}</Badge>
        <span title={match.fallbackReason ? errorName(t, match.fallbackReason) : undefined}>
          {t('matches.source')}: {codeName(t, 'source', match.source)}
        </span>
      </div>
    </Card>
  );
}

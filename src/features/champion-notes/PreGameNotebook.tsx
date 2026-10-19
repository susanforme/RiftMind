import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import type { LiveSnapshot } from '../../generated/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { ChampionSelect } from '../../components/ChampionSelect';
import { SearchSelect } from '../../components/SearchSelect';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { ErrorNotice } from '../../components/ErrorNotice';
import { championName } from '../../lib/display-names';
import { NotebookEntryView } from './ChampionNotebookPage';
export function PreGameNotebook({ snapshot, epoch }: { snapshot?: LiveSnapshot; epoch?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [manualChampion, setManualChampion] = useState<{ context: string; id?: number }>();
  const [manualOpponent, setManualOpponent] = useState('all');
  const contextKnown = !!snapshot && !snapshot.stale;
  const current = contextKnown ? snapshot.seats.find((seat) => seat.current) : undefined;
  const contextKey = `${snapshot?.sessionEpoch}:${snapshot?.generation}:${snapshot?.phase}:${current?.championId}`;
  const championId =
    (manualChampion?.context === contextKey ? manualChampion.id : undefined) ||
    current?.championId ||
    undefined;
  const opponents =
    contextKnown && current
      ? snapshot.seats.filter((seat) => seat.teamId !== current.teamId && seat.championId)
      : [];
  // Selectors reset with the live generation; opened content stays in its own notebook tab.
  const opponent = opponents.some((seat) => String(seat.championId) === manualOpponent)
    ? Number(manualOpponent)
    : null;
  const entries = useQuery({
    queryKey: [
      'notebooks',
      epoch,
      'quick',
      snapshot?.sessionEpoch,
      snapshot?.generation,
      snapshot?.revision,
      championId,
      opponent,
    ],
    queryFn: () =>
      transport.call('list_notebook_entries', {
        championId: championId!,
        kind: null,
        search: '',
        opponentId: null,
        trash: false,
      }),
    enabled: open && !!championId && !!epoch,
  });
  const visible =
    entries.data?.filter(
      (entry) => !entry.content.opponentId || !opponent || entry.content.opponentId === opponent,
    ) || [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t('notebooks.quickReference')}
          </Button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
          <div data-ui="actions" className="flex items-center gap-2">
            <ChampionSelect
              value={championId}
              onValueChange={(id) => setManualChampion({ context: contextKey, id })}
            />
            <SearchSelect
              label={t('notebooks.opponent')}
              value={opponent ? String(opponent) : 'all'}
              options={[
                { value: 'all', label: t('scouting.all') },
                ...opponents.map((seat) => ({
                  value: String(seat.championId),
                  label: championName(t, seat.championId),
                  icon: (
                    <GameEntityIcon
                      kind="champion"
                      id={seat.championId}
                      label={championName(t, seat.championId)}
                    />
                  ),
                })),
              ]}
              onValueChange={setManualOpponent}
            />
            <Button
              variant="outline"
              disabled={!championId}
              onClick={() => void navigate({ to: '/notebooks', search: { champion: championId } })}
            >
              {t('notebooks.titlePage')}
            </Button>
          </div>
          <ErrorNotice error={entries.error} />
          {!visible.length && <p>{t('notebooks.empty')}</p>}
          {visible.map((entry) => (
            <Collapsible key={entry.id} defaultOpen={entry.content.pinned}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="group h-auto min-h-9 w-full justify-start gap-2 px-0 py-2 text-left text-sm font-normal whitespace-normal text-muted-foreground"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                  />
                  {entry.content.title}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent
                forceMount
                className="hidden min-w-0 pb-2 data-[state=open]:block"
              >
                <NotebookEntryView entry={entry} />
                <Button
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: '/notebooks',
                      search: { champion: championId, entry: entry.id },
                    })
                  }
                >
                  {t('notebooks.openContent')}
                </Button>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

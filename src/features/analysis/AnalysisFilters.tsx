import { ChampionSelect } from '../../components/ChampionSelect';
import { playerName } from '../../lib/display-names';
import { serverName } from '../../lib/server-name';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { Player } from '../../generated/contracts';
import type { Search } from '../../app/router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
export function AnalysisFilters({
  search,
  onChange,
  player,
  players,
  onPlayer,
}: {
  search: Search;
  onChange: (s: Search) => void;
  player?: string;
  players?: Player[];
  onPlayer?: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(search);
  return (
    <form
      data-ui="analysis-filters"
      className="grid min-w-0 grid-cols-2 items-end gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-3 xl:grid-cols-5 [&_label]:grid [&_label]:min-w-0 [&_label]:gap-2 [&_label]:text-xs [&_label]:text-muted-foreground [&_input]:w-full [&_button[role=combobox]]:w-full [&_button[role=combobox]]:min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft);
      }}
    >
      {onPlayer && (
        <Label>
          {t('matches.openPlayer')}
          <Select value={player || ''} onValueChange={onPlayer}>
            <SelectTrigger>
              <SelectValue placeholder={t('matches.selectPlayer')} />
            </SelectTrigger>
            <SelectContent>
              {players?.map((p) => (
                <SelectItem key={p.playerKey} value={p.playerKey}>
                  {playerName(t, p)} · {serverName(t, p.serverId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
      )}
      <Label>
        {t('matches.queue')}
        <Select
          value={String(draft.queue || 'all')}
          onValueChange={(v) => setDraft({ ...draft, queue: Number(v) || undefined })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('matches.allQueues')}</SelectItem>
            <SelectItem value="420">{t('matches.ranked')}</SelectItem>
            <SelectItem value="440">{t('review.flex')}</SelectItem>
            <SelectItem value="450">{t('matches.aram')}</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <Label>
        {t('scouting.position')}
        <Select
          value={draft.position || 'all'}
          onValueChange={(v) => setDraft({ ...draft, position: v === 'all' ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['all', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN'].map((p) => (
              <SelectItem key={p} value={p}>
                {p === 'all'
                  ? t('scouting.all')
                  : p === 'UNKNOWN'
                    ? t('scouting.unknownPosition')
                    : t(`matches.position_${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <Label>
        {t('scouting.patch')}
        <Input
          value={draft.patch || ''}
          maxLength={20}
          onChange={(e) => setDraft({ ...draft, patch: e.target.value || undefined })}
        />
      </Label>
      <Label>
        {t('matches.champion')}
        <ChampionSelect
          value={draft.champion}
          onValueChange={(champion) => setDraft({ ...draft, champion })}
        />
      </Label>
      <Label>
        {t('matches.from')}
        <Input
          type="date"
          value={draft.from || ''}
          max={draft.to}
          onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })}
        />
      </Label>
      <Label>
        {t('matches.to')}
        <Input
          type="date"
          value={draft.to || ''}
          min={draft.from}
          onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })}
        />
      </Label>
      <div className="col-span-2 flex flex-wrap items-center gap-2 self-end">
        <Button type="submit" variant="outline">
          {t('matches.filter')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft({});
            onChange({});
          }}
        >
          {t('common.reset')}
        </Button>
      </div>
    </form>
  );
}

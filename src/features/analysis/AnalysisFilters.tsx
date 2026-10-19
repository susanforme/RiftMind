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
      className="flex items-end gap-2.5 mb-5 [&_>_svg]:text-muted-foreground [&_>_svg]:mt-0 [&_>_svg]:mr-0.5 [&_>_svg]:mb-[9px] [&_>_svg]:ml-0 [&_label]:grid [&_label]:gap-1.5 [&_label]:flex-1 [&_label]:min-w-[125px] [&_label]:max-w-[200px] [&_label_>_span]:text-[12px] [&_label_>_span]:text-muted-foreground [&_input]:h-9 [&_input]:bg-card [&_input]:text-[12px] [&_input]:shadow-none [&_button[role=combobox]]:w-full [&_button[role=combobox]]:h-9 [&_button[role=combobox]]:bg-card [&_button[role=combobox]]:text-[12px] [&_button[role=combobox]]:shadow-none [&_>_[data-slot=button]]:h-9 max-[650.01px]:[&_label]:min-w-[125px] max-[650.01px]:[&_label]:max-w-none max-[650.01px]:[&_>_svg]:hidden flex-wrap [&&_>_label]:min-w-[100px] [&&_>_label]:flex-1 [&_input]:w-full max-[960.01px]:[&&_>_label]:min-w-[130px]"
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
    </form>
  );
}

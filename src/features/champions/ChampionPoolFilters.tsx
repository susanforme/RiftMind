import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Search } from '../../app/router';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { queueName } from '../../lib/display-names';
import { championQueueIds, selectedChampionQueues } from './champion-pool';

export function ChampionPoolFilters({
  search,
  onChange,
}: {
  search: Search;
  onChange: (search: Search) => void;
}) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draft, setDraft] = useState(search);
  const queues = selectedChampionQueues(search);
  const queueLabel = !queues.length
    ? t('matches.allQueues')
    : `${queueName(t, queues[0])}${queues.length > 1 ? ` +${queues.length - 1}` : ''}`;
  const options = [...new Set([...championQueueIds, ...queues])];
  const localDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dateRange =
    !search.from && !search.to
      ? 'all'
      : [30, 90]
          .find((days) => {
            const today = new Date();
            const start = new Date(today);
            start.setDate(start.getDate() - days + 1);
            return search.from === localDate(start) && search.to === localDate(today);
          })
          ?.toString() || 'custom';
  return (
    <div data-ui="champion-filters" className="flex min-h-10 flex-wrap items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="min-w-44 justify-between bg-card"
            aria-label={t('matches.queue')}
          >
            <span className="truncate">{queueLabel}</span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
          <DropdownMenuCheckboxItem
            checked={!queues.length}
            onCheckedChange={() => onChange({ ...search, queue: undefined, queues: [] })}
            onSelect={(event) => event.preventDefault()}
          >
            {t('matches.allQueues')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {options.map((queue) => (
            <DropdownMenuCheckboxItem
              key={queue}
              checked={queues.includes(queue)}
              disabled={queues.length === 1 && queues[0] === queue}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onChange({
                  ...search,
                  queue: undefined,
                  queues: checked
                    ? [...queues, queue].sort((left, right) => left - right)
                    : queues.filter((selected) => selected !== queue),
                })
              }
            >
              {queueName(t, queue)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Select
        value={search.position || 'all'}
        onValueChange={(position) =>
          onChange({ ...search, position: position === 'all' ? undefined : position })
        }
      >
        <SelectTrigger aria-label={t('scouting.position')} className="w-40 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('scouting.allPositions')}</SelectItem>
          {['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN'].map((position) => (
            <SelectItem key={position} value={position}>
              {position === 'UNKNOWN'
                ? t('scouting.unknownPosition')
                : t(`matches.position_${position}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={dateRange}
        onValueChange={(range) => {
          if (range === 'custom') {
            setDraft(search);
            setAdvancedOpen(true);
            return;
          }
          if (range === 'all') {
            onChange({ ...search, from: undefined, to: undefined });
            return;
          }
          const end = new Date();
          const start = new Date(end);
          start.setDate(start.getDate() - Number(range) + 1);
          onChange({
            ...search,
            from: localDate(start),
            to: localDate(end),
          });
        }}
      >
        <SelectTrigger aria-label={t('scouting.dateRange')} className="w-40 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('scouting.allTime')}</SelectItem>
          <SelectItem value="30">{t('scouting.last30Days')}</SelectItem>
          <SelectItem value="90">{t('scouting.last90Days')}</SelectItem>
          <SelectItem value="custom">{t('scouting.dateRange')}</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        className="bg-card"
        onClick={() => {
          setDraft(search);
          setAdvancedOpen(true);
        }}
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        {t('scouting.moreFilters')}
      </Button>
      <Button variant="ghost" onClick={() => onChange({ player: search.player, queues: [420] })}>
        {t('common.reset')}
      </Button>
      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('scouting.moreFilters')}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              onChange(draft);
              setAdvancedOpen(false);
            }}
          >
            <Label className="grid gap-2">
              {t('scouting.patch')}
              <Input
                value={draft.patch || ''}
                pattern="[0-9]+\.[0-9]+"
                maxLength={20}
                onChange={(event) => setDraft({ ...draft, patch: event.target.value || undefined })}
              />
            </Label>
            <Label className="grid gap-2">
              {t('matches.from')}
              <Input
                type="date"
                value={draft.from || ''}
                max={draft.to}
                onChange={(event) => setDraft({ ...draft, from: event.target.value || undefined })}
              />
            </Label>
            <Label className="grid gap-2">
              {t('matches.to')}
              <Input
                type="date"
                value={draft.to || ''}
                min={draft.from}
                onChange={(event) => setDraft({ ...draft, to: event.target.value || undefined })}
              />
            </Label>
            <DialogFooter>
              <Button type="submit">{t('matches.filter')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NotebookEntry } from '../../generated/contracts';
import { championName } from '../../lib/display-names';
import { Button } from '../../components/ui/button';
import { GameEntityIcon } from '../../components/GameEntityIcon';

export function NotebookEntryList({
  entries,
  selectedId,
  onSelect,
}: {
  entries: NotebookEntry[];
  selectedId?: string;
  onSelect: (entry: NotebookEntry) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <ul aria-label={t('notebooks.directory')} className="m-0 grid list-none gap-1 p-2">
      {entries.map((entry) => (
        <li key={entry.id} className="min-w-0">
          <Button
            variant="ghost"
            aria-label={entry.content.title}
            aria-current={selectedId === entry.id ? 'true' : undefined}
            onClick={() => onSelect(entry)}
            className="h-auto min-h-28 w-full items-start justify-start gap-3 rounded-lg border border-transparent p-3 text-left whitespace-normal text-foreground hover:bg-muted/60 aria-current:border-primary/30 aria-current:bg-primary/10"
          >
            <GameEntityIcon
              kind="champion"
              id={entry.content.opponentId || entry.content.championId}
              label={championName(t, entry.content.opponentId || entry.content.championId)}
              className="mt-0.5 size-10 rounded-lg"
            />
            <span className="grid min-w-0 flex-1 gap-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="line-clamp-2 flex-1 wrap-anywhere font-semibold leading-5">
                  {entry.content.title}
                </span>
                {entry.content.pinned && (
                  <Pin aria-label={t('notebooks.pinned')} className="size-3.5 text-primary" />
                )}
              </span>
              {entry.content.text && (
                <span className="line-clamp-2 text-xs leading-5 wrap-anywhere text-muted-foreground">
                  {entry.content.text}
                </span>
              )}
              <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground">
                <span>{t(`notebooks.kind_${entry.content.kind}`)}</span>
                <time dateTime={entry.updatedAt}>
                  {new Date(entry.updatedAt).toLocaleDateString(i18n.language, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </time>
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

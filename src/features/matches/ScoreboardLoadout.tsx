import { useTranslation } from 'react-i18next';
import { GameEntityDetails } from '../../components/GameEntityDetails';
import { spellName } from '../../lib/display-names';
import type { ScoreboardParticipant } from '../../generated/contracts';

export function ScoreboardSpells({
  participant,
  version,
  interactive = true,
}: {
  participant: ScoreboardParticipant;
  version: string;
  interactive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="grid grid-cols-2 gap-1">
      {participant.spells.map((id, index) => (
        <GameEntityDetails
          key={`spell:${index}`}
          kind="spell"
          interactive={interactive}
          id={id}
          version={version}
          label={spellName(t, id)}
          className="size-5 rounded-sm"
        />
      ))}
      {[participant.primaryRune, participant.secondaryRune].map((id, index) => (
        <GameEntityDetails
          key={`rune:${index}`}
          kind="rune"
          interactive={interactive}
          id={id}
          version={version}
          label={t('matches.rune', { id: id ?? '—' })}
          className="size-5 rounded-full"
        />
      ))}
    </span>
  );
}

export function ScoreboardItems({
  items,
  roleItem,
  version,
  compact = false,
  interactive = true,
}: {
  items: number[];
  roleItem?: number | null;
  version: string;
  compact?: boolean;
  interactive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-1" aria-label={t('matches.items')}>
      {Array.from({ length: 7 }, (_, slot) => items[slot] || 0).map((id, slot) => (
        <GameEntityDetails
          key={`item:${slot}`}
          kind="item"
          interactive={interactive}
          id={id}
          version={version}
          label={id ? t('labels.item', { id }) : t('matches.emptyItem')}
          className={compact ? 'size-6 rounded-sm' : 'size-7 rounded-sm'}
        />
      ))}
      {!!roleItem && (
        <GameEntityDetails
          kind="item"
          interactive={interactive}
          id={roleItem}
          version={version}
          label={t('labels.item', { id: roleItem })}
          className={compact ? 'ml-1 size-6 rounded-full' : 'ml-1 size-7 rounded-full'}
        />
      )}
    </span>
  );
}

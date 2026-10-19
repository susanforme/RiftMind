import { Fragment } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { GameEntityIcon, skillResourceId } from '../../components/GameEntityIcon';

const skillKeys = ['Q', 'W', 'E', 'R'];

export function SkillOrderEditor({
  championId,
  order,
  onChange,
}: {
  championId: number;
  order: number[];
  onChange: (order: number[]) => void;
}) {
  const { t } = useTranslation();
  const levels = Array.from({ length: 18 }, (_, index) => index + 1);
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status" className="text-sm text-muted-foreground">
          {t('notebooks.skillProgress', { count: order.filter(Boolean).length })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!order.some(Boolean)}
          onClick={() => onChange([])}
        >
          <RotateCcw aria-hidden="true" />
          {t('notebooks.clearSkillOrder')}
        </Button>
      </div>
      <div
        className="overflow-x-auto rounded-lg border border-border p-3"
        tabIndex={0}
        role="region"
        aria-label={t('notebooks.skillOrder')}
      >
        <div className="grid min-w-[660px] grid-cols-[52px_repeat(18,minmax(26px,1fr))] items-center justify-items-center gap-x-1 gap-y-3">
          <span className="text-xs text-muted-foreground">{t('notebooks.level')}</span>
          {levels.map((level) => (
            <span key={level} className="text-xs tabular-nums text-muted-foreground">
              {level}
            </span>
          ))}
          {skillKeys.map((key, index) => (
            <Fragment key={key}>
              <div className="flex items-center gap-1.5">
                <GameEntityIcon
                  kind="skill"
                  id={skillResourceId(championId, index + 1)}
                  label={key}
                  className="size-8"
                />
                <span className="text-xs font-semibold">{key}</span>
              </div>
              {levels.map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7 rounded-md border-border p-0 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  aria-pressed={order[level - 1] === index + 1}
                  aria-label={t('notebooks.learnSkill', { level, skill: key })}
                  onClick={() => {
                    const nextOrder = Array.from(
                      { length: 18 },
                      (_, position) => order[position] || 0,
                    );
                    nextOrder[level - 1] = nextOrder[level - 1] === index + 1 ? 0 : index + 1;
                    onChange(nextOrder);
                  }}
                >
                  {order[level - 1] === index + 1 && (
                    <Check aria-hidden="true" className="size-3" />
                  )}
                </Button>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkillOrderView({ championId, order }: { championId: number; order: number[] }) {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t('notebooks.skillOrder')}
      className="m-0 grid list-none grid-cols-6 gap-2 p-0 min-[1100px]:grid-cols-9"
    >
      {Array.from({ length: 18 }, (_, index) => {
        const slot = order[index] || 0;
        return (
          <li
            key={index}
            className="grid justify-items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-1 py-2"
            aria-label={t('notebooks.learnSkill', {
              level: index + 1,
              skill: slot ? skillKeys[slot - 1] : t('notebooks.unassigned'),
            })}
          >
            <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            {slot ? (
              <GameEntityIcon
                kind="skill"
                id={skillResourceId(championId, slot)}
                label={skillKeys[slot - 1]}
                className="size-8"
              />
            ) : (
              <span className="grid size-8 place-items-center text-muted-foreground">—</span>
            )}
            <span className="text-xs font-semibold">{slot ? skillKeys[slot - 1] : '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}

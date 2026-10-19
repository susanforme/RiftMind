import { useQuery } from '@tanstack/react-query';
import { transport } from '../../app/runtime';
import { spellName } from '../../lib/display-names';
import { useTranslation } from 'react-i18next';
import type { ComboStep, ComboAction } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { SearchSelect } from '../../components/SearchSelect';
import { GameEntityIcon, skillResourceId } from '../../components/GameEntityIcon';
export function ComboSequence({ championId, steps }: { championId: number; steps: ComboStep[] }) {
  const { t } = useTranslation();
  return (
    <ol
      data-ui="combo-sequence"
      className="flex flex-wrap items-center gap-2 list-none p-0 [&_li]:flex [&_li]:items-center [&_li]:gap-1.5 [&_li]:py-1 [&_li]:px-2 [&_li]:border [&_li]:border-border [&_li]:rounded-[var(--radius)]"
    >
      {steps.map((step, index) => (
        <li key={`${index}:${step.action}`}>
          {['skill', 'spell', 'item'].includes(step.action) && (
            <GameEntityIcon
              kind={step.action === 'skill' ? 'skill' : step.action === 'spell' ? 'spell' : 'item'}
              id={
                step.action === 'skill' ? skillResourceId(championId, step.entityId) : step.entityId
              }
              label={step.label || t(`notebooks.action_${step.action}`)}
            />
          )}
          <span>
            {step.action === 'skill' ? ['Q', 'W', 'E', 'R'][(step.entityId || 1) - 1] : ''}
            {step.label
              ? ` ${step.label}`
              : step.action === 'skill'
                ? ''
                : t(`notebooks.action_${step.action}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}
export function ComboEditor({
  championId,
  steps,
  onChange,
}: {
  championId: number;
  steps: ComboStep[];
  onChange: (steps: ComboStep[]) => void;
}) {
  const { t } = useTranslation();
  const catalogue = useQuery({
    queryKey: ['item-catalogue', '16.20.1', 'combo'],
    queryFn: () => transport.call('get_item_catalogue', { version: '16.20.1', locale: 'en-US' }),
    enabled: steps.some((step) => step.action === 'item'),
    staleTime: Infinity,
    retry: false,
  });
  const update = (index: number, patch: Partial<ComboStep>) =>
    onChange(steps.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  const move = (index: number, direction: number) => {
    const reordered = [...steps];
    [reordered[index], reordered[index + direction]] = [
      reordered[index + direction],
      reordered[index],
    ];
    onChange(reordered);
  };
  return (
    <div data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
      <ComboSequence championId={championId} steps={steps} />
      {steps.map((step, index) => (
        <div
          className="flex items-end flex-wrap gap-2 py-3 px-0 border-b border-b-border [&_>_label]:flex-1 [&_>_label]:min-w-[100px]"
          key={index}
        >
          <SearchSelect
            label={t('notebooks.action')}
            value={step.action}
            options={(['skill', 'attack', 'move', 'spell', 'item', 'text'] as ComboAction[]).map(
              (action) => ({ value: action, label: t(`notebooks.action_${action}`) }),
            )}
            onValueChange={(action) =>
              update(index, {
                action: action as ComboAction,
                entityId: action === 'skill' ? 1 : action === 'spell' ? 4 : null,
              })
            }
          />
          {step.action === 'skill' && (
            <SearchSelect
              label={t('notebooks.skill')}
              value={String(step.entityId || 1)}
              options={['Q', 'W', 'E', 'R'].map((label, slot) => ({
                value: String(slot + 1),
                label,
                icon: (
                  <GameEntityIcon
                    kind="skill"
                    id={skillResourceId(championId, slot + 1)}
                    label={label}
                  />
                ),
              }))}
              onValueChange={(slot) => update(index, { entityId: Number(slot) })}
            />
          )}
          {step.action === 'spell' && (
            <SearchSelect
              label={t('notebooks.action_spell')}
              value={String(step.entityId || 4)}
              options={[4, 7, 14, 11, 12, 3, 6, 21, 1, 13, 32].map((id) => ({
                value: String(id),
                label: spellName(t, id),
                icon: <GameEntityIcon kind="spell" id={id} label={spellName(t, id)} />,
              }))}
              onValueChange={(id) => update(index, { entityId: Number(id) })}
            />
          )}
          {step.action === 'item' && (
            <SearchSelect
              label={t('notebooks.action_item')}
              value={String(step.entityId || '')}
              options={(catalogue.data?.items || []).map((equipment) => ({
                value: String(equipment.id),
                label: equipment.name,
                icon: <GameEntityIcon kind="item" id={equipment.id} label={equipment.name} />,
              }))}
              onValueChange={(id) => update(index, { entityId: Number(id) })}
            />
          )}
          <Label>
            {t('notebooks.stepLabel')}
            <Input
              aria-label={t('notebooks.stepLabel')}
              value={step.label}
              maxLength={500}
              onChange={(event) => update(index, { label: event.target.value })}
            />
          </Label>
          <div data-ui="actions" className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={index === 0}
              onClick={() => move(index, -1)}
              aria-label={t('notebooks.moveUp')}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={index === steps.length - 1}
              onClick={() => move(index, 1)}
              aria-label={t('notebooks.moveDown')}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange(steps.filter((_, position) => position !== index))}
            >
              {t('review.delete')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange([
                  ...steps.slice(0, index + 1),
                  { action: 'text', entityId: null, label: '' },
                  ...steps.slice(index + 1),
                ])
              }
            >
              {t('notebooks.insert')}
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={steps.length >= 100}
        onClick={() => onChange([...steps, { action: 'skill', entityId: 1, label: '' }])}
      >
        {t('notebooks.addStep')}
      </Button>
    </div>
  );
}

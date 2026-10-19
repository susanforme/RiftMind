import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import type { BuildGroup } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent } from '../../components/ui/card';
import { SearchSelect } from '../../components/SearchSelect';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { ErrorNotice } from '../../components/ErrorNotice';
export function BuildGroups({ groups, version }: { groups: BuildGroup[]; version: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-4 [&_>_div]:grid [&_>_div]:gap-3 [&_>_div]:rounded-lg [&_>_div]:border [&_>_div]:border-border [&_>_div]:bg-muted/20 [&_>_div]:p-3">
      {groups.map((group, index) => (
        <div key={index}>
          <strong>{group.name}</strong>
          <div data-ui="actions" className="flex items-center gap-2">
            {group.items.map((equipment, position) => (
              <span
                className="inline-flex items-center gap-1.5 align-middle text-xs tabular-nums"
                key={position}
              >
                <GameEntityIcon
                  kind="item"
                  id={equipment.id}
                  version={version}
                  label={t('notebooks.equipment', { id: equipment.id })}
                  className="size-10 border border-border"
                />
                <span>×{equipment.count}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
export function ItemBuildEditor({
  groups,
  version,
  mapId,
  onChange,
  onVersion,
  onMap,
}: {
  groups: BuildGroup[];
  version: string;
  mapId: number;
  onChange: (groups: BuildGroup[]) => void;
  onVersion: (version: string) => void;
  onMap: (map: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const catalogue = useQuery({
    queryKey: ['item-catalogue', version, i18n.language],
    queryFn: () =>
      transport.call('get_item_catalogue', {
        version,
        locale: i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
      }),
    retry: false,
    enabled: /^\d+\.\d+(\.\d+)?$/.test(version),
    staleTime: Infinity,
  });
  const change = (index: number, group: BuildGroup) =>
    onChange(groups.map((candidate, position) => (position === index ? group : candidate)));
  return (
    <div data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
      <div data-ui="actions" className="flex items-center gap-2">
        <Label>
          {t('notebooks.resourceVersion')}
          <Input
            aria-label={t('notebooks.resourceVersion')}
            value={version}
            onChange={(event) => onVersion(event.target.value)}
          />
        </Label>
        <SearchSelect
          label={t('notebooks.map')}
          value={String(mapId)}
          options={[
            { value: '11', label: t('notebooks.rift') },
            { value: '12', label: t('notebooks.abyss') },
          ]}
          onValueChange={(map) => onMap(Number(map))}
        />
      </div>
      <ErrorNotice error={catalogue.error} />
      {groups.map((group, index) => (
        <Card key={index}>
          <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
            <Label>
              {t('notebooks.groupName')}
              <Input
                aria-label={t('notebooks.groupName')}
                value={group.name}
                onChange={(event) => change(index, { ...group, name: event.target.value })}
              />
            </Label>
            <SearchSelect
              label={t('notebooks.addEquipment')}
              value=""
              options={(catalogue.data?.items || [])
                .filter((equipment) => equipment.purchasable && equipment.maps.includes(mapId))
                .map((equipment) => ({
                  value: String(equipment.id),
                  label: equipment.name,
                  icon: (
                    <span aria-hidden="true">
                      <GameEntityIcon
                        kind="item"
                        id={equipment.id}
                        version={version}
                        label={equipment.name}
                      />
                    </span>
                  ),
                }))}
              onValueChange={(id) =>
                change(index, { ...group, items: [...group.items, { id: Number(id), count: 1 }] })
              }
            />
            {group.items.map((equipment, position) => (
              <div data-ui="actions" className="flex items-center gap-2" key={position}>
                <GameEntityIcon
                  kind="item"
                  id={equipment.id}
                  version={version}
                  label={
                    catalogue.data?.items.find((candidate) => candidate.id === equipment.id)
                      ?.name || t('notebooks.equipment', { id: equipment.id })
                  }
                />
                <span>
                  {catalogue.data?.items.find((candidate) => candidate.id === equipment.id)?.name ||
                    equipment.id}
                </span>
                <Input
                  className="w-20"
                  type="number"
                  min={1}
                  max={99}
                  aria-label={t('notebooks.quantity')}
                  value={equipment.count}
                  onChange={(event) =>
                    change(index, {
                      ...group,
                      items: group.items.map((candidate, cursor) =>
                        cursor === position
                          ? { ...candidate, count: Number(event.target.value) }
                          : candidate,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('notebooks.moveUp')}
                  disabled={position === 0}
                  onClick={() => {
                    const items = [...group.items];
                    [items[position - 1], items[position]] = [items[position], items[position - 1]];
                    change(index, { ...group, items });
                  }}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('notebooks.moveDown')}
                  disabled={position === group.items.length - 1}
                  onClick={() => {
                    const items = [...group.items];
                    [items[position + 1], items[position]] = [items[position], items[position + 1]];
                    change(index, { ...group, items });
                  }}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    change(index, {
                      ...group,
                      items: group.items.filter((_, cursor) => cursor !== position),
                    })
                  }
                >
                  {t('review.delete')}
                </Button>
              </div>
            ))}
            <div data-ui="actions" className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={index === 0}
                onClick={() => {
                  const reordered = [...groups];
                  [reordered[index - 1], reordered[index]] = [
                    reordered[index],
                    reordered[index - 1],
                  ];
                  onChange(reordered);
                }}
              >
                {t('notebooks.moveUp')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={index === groups.length - 1}
                onClick={() => {
                  const reordered = [...groups];
                  [reordered[index + 1], reordered[index]] = [
                    reordered[index],
                    reordered[index + 1],
                  ];
                  onChange(reordered);
                }}
              >
                {t('notebooks.moveDown')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onChange(groups.filter((_, position) => position !== index))}
              >
                {t('review.delete')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...groups, { name: t('notebooks.group'), items: [] }])}
      >
        {t('notebooks.addGroup')}
      </Button>
    </div>
  );
}

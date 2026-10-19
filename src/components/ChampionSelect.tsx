import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { transport } from '../app/runtime';
import { championIds, championName } from '../lib/display-names';
import championNamesZh from '../i18n/locales/zh-CN/labels.json';
import championNamesEn from '../i18n/locales/en-US/labels.json';
import championAliases from '../lib/champion-aliases.json';
import { SearchSelect } from './SearchSelect';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

// The portrait catalogue uses the same pinned patch as the bundled champion names.
const catalogueVersion = '16.20.1';

export function ChampionSelect({
  value,
  onValueChange,
}: {
  value?: number;
  onValueChange: (value: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const options = [
    { value: 'all', label: t('matches.allChampions') },
    ...championIds.map((id) => ({
      value: String(id),
      label: championName(t, id),
      keywords: [
        championAliases[String(id) as keyof typeof championAliases],
        championNamesZh[`champion_${id}` as keyof typeof championNamesZh],
        championNamesEn[`champion_${id}` as keyof typeof championNamesEn],
      ],
      icon: <ChampionPortrait id={id} />,
    })),
  ];
  return (
    <SearchSelect
      label={t('matches.champion')}
      options={options}
      value={String(value || 'all')}
      onValueChange={(value) => onValueChange(value === 'all' ? undefined : Number(value))}
    />
  );
}

function ChampionPortrait({ id }: { id: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const asset = useQuery({
    queryKey: ['champion-portrait', catalogueVersion, id],
    queryFn: () =>
      transport.call('resolve_assets', {
        version: catalogueVersion,
        locale: 'en-US',
        championIds: [id],
        resourceIds: [],
      }),
    enabled: visible,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <Avatar ref={ref} className="size-7 rounded-md" aria-hidden="true">
      <AvatarImage src={asset.data?.[0]?.reference || undefined} alt="" className="object-cover" />
      <AvatarFallback className="rounded-md">
        <CircleHelp className="size-4 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  );
}

import { useTranslation } from 'react-i18next';
import { Shield, TrendingUp, FileText } from 'lucide-react';
import type { NotebookContent } from '../../generated/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { ItemBuildEditor } from '../builds/ItemBuildEditor';
import { SkillOrderEditor } from './SkillOrderEditor';

export function ChampionBuildEditor({
  content,
  onChange,
}: {
  content: NotebookContent;
  onChange: (patch: Partial<NotebookContent>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="equipment" className="min-w-0">
      <TabsList aria-label={t('notebooks.planSections')} className="mb-4 h-11 w-full justify-start">
        <TabsTrigger value="equipment" className="h-9 gap-2">
          <Shield aria-hidden="true" className="size-4" />
          {t('notebooks.equipmentPlan')}
        </TabsTrigger>
        <TabsTrigger value="skills" className="h-9 gap-2">
          <TrendingUp aria-hidden="true" className="size-4" />
          {t('notebooks.skillOrder')}
        </TabsTrigger>
        <TabsTrigger value="notes" className="h-9 gap-2">
          <FileText aria-hidden="true" className="size-4" />
          {t('notebooks.planNotes')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="equipment">
        <ItemBuildEditor
          groups={content.groups}
          version={content.resourceVersion || ''}
          mapId={content.mapId || 11}
          onChange={(groups) => onChange({ groups })}
          onVersion={(resourceVersion) => onChange({ resourceVersion })}
          onMap={(mapId) => onChange({ mapId })}
        />
      </TabsContent>
      <TabsContent value="skills">
        <SkillOrderEditor
          championId={content.championId}
          order={content.skillOrder || []}
          onChange={(skillOrder) => onChange({ skillOrder })}
        />
      </TabsContent>
      <TabsContent value="notes">
        <Label>
          {t('notebooks.planNotes')}
          <Textarea
            aria-label={t('notebooks.content')}
            className="min-h-48 resize-y text-base leading-7"
            maxLength={100000}
            value={content.text}
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </Label>
      </TabsContent>
    </Tabs>
  );
}

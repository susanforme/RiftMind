import { Label } from '../../components/ui/label';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../components/ui/select';
import { transport } from '../runtime';
import zh from './zh-CN.json';
import en from './en-US.json';

const scenarios = [
  'no-client',
  'tencent',
  'riot',
  'offline',
  'waiting',
  'conflict',
  'unknown',
] as const;
export default function DevToolbar() {
  const { i18n } = useTranslation();
  const copy = i18n.language === 'zh-CN' ? zh : en;
  async function changeScenario(scenario: string) {
    if (transport.mode === 'fixture')
      (await import('../../lib/transport/fixture')).setScenario(scenario);
    else
      await fetch('/bridge/scenario', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-riftmind-token': import.meta.env.VITE_HARNESS_TOKEN || '',
        },
        body: JSON.stringify({ scenario }),
      });
  }
  return (
    <div
      className="py-[3px] px-4 text-muted-foreground text-[10px] flex items-center justify-end gap-[15px] shrink-0 border-b border-b-border [&_>_span]:whitespace-nowrap [&_label]:whitespace-nowrap [&_label]:flex [&_label]:gap-2 [&_label]:items-center [&_button[role=combobox]]:h-6 [&_button[role=combobox]]:w-[130px] [&_button[role=combobox]]:text-[10px] [&_button[role=combobox]]:border-0 [&_button[role=combobox]]:py-0 [&_button[role=combobox]]:px-1.5"
      data-testid="dev-toolbar"
    >
      <Label htmlFor="dev-scenario">
        {copy.scenario}
        <Select
          defaultValue={import.meta.env.VITE_INITIAL_SCENARIO || 'no-client'}
          onValueChange={(scenario) => void changeScenario(scenario)}
        >
          <SelectTrigger id="dev-scenario">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scenarios.map((scenario) => (
              <SelectItem key={scenario} value={scenario}>
                {copy[scenario]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
    </div>
  );
}

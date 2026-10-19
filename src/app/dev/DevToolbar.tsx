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
import './DevToolbar.css';
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
    <div className="dev-banner" data-testid="dev-toolbar">
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

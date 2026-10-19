import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from './ui/combobox';

export type SearchSelectOption = {
  value: string;
  label: string;
  keywords?: string[];
  icon?: ReactNode;
  disabled?: boolean;
};

type SearchSelectProps = {
  id?: string;
  label: string;
  options: SearchSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

/** Editable filtering; only choosing an existing option changes the selected value. */
export function SearchSelect({ id, label, options, value, onValueChange, disabled }: SearchSelectProps) {
  const generatedId = useId();
  const { t } = useTranslation();
  const [query, setQuery] = useState<string | null>(null);
  const selected = options.find(option => option.value === value) ?? null;
  return <Combobox<SearchSelectOption>
    items={options}
    value={selected}
    disabled={disabled}
    inputValue={query ?? selected?.label ?? ''}
    onInputValueChange={(text, details) => { if (details.reason === 'input-change') setQuery(text); }}
    onOpenChange={open => { if (!open) setQuery(null); }}
    itemToStringLabel={option => option.label}
    isItemEqualToValue={(a, b) => a.value === b.value}
    filter={(option, text) => [option.label, ...(option.keywords || [])].some(name => name.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()))}
    onValueChange={option => {
      if (option && !option.disabled && options.some(item => item.value === option.value)) {
        setQuery(null);
        onValueChange(option.value);
      }
    }}
  >
    <ComboboxInput disabled={disabled} id={id || generatedId} aria-label={label} placeholder={label} triggerLabel={t('common.openOptions')} className="search-select w-full bg-card shadow-none" onBlur={() => setQuery(null)} />
    <ComboboxContent>
      <ComboboxEmpty>{t('common.noOptions')}</ComboboxEmpty>
      <ComboboxList>{(option: SearchSelectOption) => <ComboboxItem key={option.value} value={option} disabled={option.disabled}>
        {option.icon}<span>{option.label}</span>
      </ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}

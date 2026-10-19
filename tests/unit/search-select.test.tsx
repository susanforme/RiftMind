import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { SearchSelect } from '../../src/components/SearchSelect';
import i18n from '../../src/i18n';

const change = vi.fn();
const options = [
  { value: 'all', label: 'All champions' },
  { value: '103', label: 'Ahri', keywords: ['阿狸', '九尾妖狐'] },
  { value: '64', label: 'Lee Sin' },
  { value: '99', label: 'Lux', disabled: true },
];
function Subject({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('all');
  return (
    <SearchSelect
      label="Champion"
      options={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        setValue(next);
        change(next);
      }}
    />
  );
}
beforeEach(async () => {
  change.mockClear();
  await i18n.changeLanguage('en-US');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('filters names and aliases, committing only an existing dropdown option', async () => {
  render(<Subject />);
  const input = screen.getByRole('combobox', { name: 'Champion' });
  act(() => input.focus());
  fireEvent.input(input, { inputType: 'insertText', target: { value: '阿狸' } });
  const option = await screen.findByRole('option', { name: 'Ahri' });
  expect(screen.queryByRole('option', { name: 'Lee Sin' })).toBeNull();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(option);
  await waitFor(() => expect(change).toHaveBeenCalledWith('103'));
  expect(input).toHaveValue('Ahri');
});

it('does not accept free text or commit an empty query, and restores the selected label', async () => {
  render(<Subject />);
  const input = screen.getByRole('combobox', { name: 'Champion' });
  act(() => input.focus());
  fireEvent.input(input, { inputType: 'insertText', target: { value: 'not-a-champion' } });
  expect(await screen.findByText('No matching options')).toBeVisible();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(input).toHaveValue('All champions'));
  fireEvent.input(input, { inputType: 'insertText', target: { value: '' } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.blur(input);
  await waitFor(() => expect(input).toHaveValue('All champions'));
});

it('supports keyboard selection and ignores Enter during IME composition', async () => {
  render(<Subject />);
  const input = screen.getByRole('combobox', { name: 'Champion' });
  act(() => input.focus());
  fireEvent.compositionStart(input);
  fireEvent.input(input, { inputType: 'insertText', target: { value: 'Ah' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect(change).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await screen.findByRole('option', { name: 'Ahri' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(change).toHaveBeenCalledWith('103'));
});

it('keeps disabled selects and options unselectable', async () => {
  const view = render(<Subject disabled />);
  expect(screen.getByRole('combobox', { name: 'Champion' })).toBeDisabled();
  view.rerender(<Subject />);
  const input = screen.getByRole('combobox', { name: 'Champion' });
  act(() => input.focus());
  fireEvent.input(input, { inputType: 'insertText', target: { value: 'Lux' } });
  const option = await screen.findByRole('option', { name: 'Lux' });
  expect(option).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(option);
  expect(change).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Escape' });
  });
});

it('keeps popup options inside a modal focus and accessibility boundary', async () => {
  const { Dialog, DialogContent, DialogTitle } = await import('../../src/components/ui/dialog');
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Choose champion</DialogTitle>
        <Subject />
      </DialogContent>
    </Dialog>,
  );
  const input = screen.getByRole('combobox', { name: 'Champion' });
  act(() => input.focus());
  fireEvent.input(input, { inputType: 'insertText', target: { value: 'Lee' } });
  const option = await screen.findByRole('option', { name: 'Lee Sin' });
  expect(screen.getByRole('dialog')).toContainElement(option);
  fireEvent.click(option);
  await waitFor(() => expect(change).toHaveBeenCalledWith('64'));
});

import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TitleBar } from '../../src/app/shell/TitleBar';
import { setTransport } from '../../src/app/runtime';
import { fixtureTransport } from '../../src/lib/transport/fixture';
import i18n from '../../src/i18n';
const native = vi.hoisted(() => ({
  maximized: false,
  resize: undefined as (() => void) | undefined,
  focus: undefined as ((event: { payload: boolean }) => void) | undefined,
  stopResize: vi.fn(), stopFocus: vi.fn(),
  minimize: vi.fn(), close: vi.fn(),
  isFocused: vi.fn(async () => true),
  isMaximized: vi.fn(async (): Promise<boolean> => native.maximized),
  toggleMaximize: vi.fn(async () => { native.maximized = !native.maximized; }),
  onResized: vi.fn(async (fn: () => void) => { native.resize = fn; return native.stopResize; }),
  onFocusChanged: vi.fn(async (fn: (event: { payload: boolean }) => void) => { native.focus = fn; return native.stopFocus; }),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }));
beforeEach(() => {
  vi.clearAllMocks(); native.maximized = false;
  native.toggleMaximize.mockImplementation(async () => { native.maximized = !native.maximized; });
  setTransport({ ...fixtureTransport(), mode: 'desktop' });
  void i18n.changeLanguage('en-US');
});
afterEach(cleanup);
it('updates maximize/restore after a click and an external resize; keeps controls outside drag regions', async () => {
  render(<TitleBar />);
  await waitFor(() => expect(native.onResized).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Maximize', exact: true }));
  expect(await screen.findByRole('button', { name: 'Restore', exact: true })).toBeInTheDocument();
  expect(native.toggleMaximize).toHaveBeenCalledOnce();
  native.maximized = false; native.resize?.();
  expect(await screen.findByRole('button', { name: 'Maximize', exact: true })).toBeInTheDocument();
  for (const button of screen.getAllByRole('button')) expect(button.closest('[data-tauri-drag-region]')).toBeNull();
});
it('calls native minimize and close, preserving the host close policy', async () => {
  render(<TitleBar />);
  await waitFor(() => expect(native.onResized).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Minimize', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Close window', exact: true }));
  await waitFor(() => { expect(native.minimize).toHaveBeenCalledOnce(); expect(native.close).toHaveBeenCalledOnce(); });
});
it('reflects inactive windows and releases native listeners', async () => {
  const view = render(<TitleBar />);
  await waitFor(() => expect(native.onFocusChanged).toHaveBeenCalledOnce());
  fireEvent(window, new Event('blur'));
  native.focus?.({ payload: false });
  await waitFor(() => expect(screen.getByRole('banner')).toHaveAttribute('data-focused', 'false'));
  view.unmount(); expect(native.stopFocus).toHaveBeenCalledOnce(); expect(native.stopResize).toHaveBeenCalledOnce();
});
it('catches failed operations and offers a dismissible error', async () => {
  native.close.mockRejectedValueOnce(new Error('denied'));
  render(<TitleBar />);
  await waitFor(() => expect(native.onResized).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Close window', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Window operation failed');
  expect(native.close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('shows disabled preview controls without calling native APIs', () => {
  setTransport(fixtureTransport()); render(<TitleBar />);
  expect(screen.getByText('RiftMind')).toBeVisible(); for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  expect(native.onResized).not.toHaveBeenCalled();
});

it('opens window actions from the titlebar context menu', async () => {
  render(<TitleBar />);
  await waitFor(() => expect(native.onResized).toHaveBeenCalledOnce());
  fireEvent.contextMenu(screen.getByRole('banner'), { clientX: 100, clientY: 20 });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Maximize', exact: true }));
  expect(await screen.findByRole('button', { name: 'Restore', exact: true })).toBeInTheDocument();
});
it('releases listeners that finish registering after unmount', async () => {
  let finish: (stop: () => void) => void = () => {};
  native.onResized.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<TitleBar />);
  await waitFor(() => expect(native.onResized).toHaveBeenCalledOnce());
  view.unmount(); finish(native.stopResize);
  await waitFor(() => expect(native.stopResize).toHaveBeenCalledOnce());
});

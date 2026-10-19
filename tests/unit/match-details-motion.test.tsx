import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useMatchDetailsMotion } from '../../src/features/matches/useMatchDetailsMotion';

let contentHeight = 320;
let resizeCallbacks: (() => void)[] = [];
const disconnect = vi.fn();

function MatchDetailsHarness({
  open,
  keepMounted = false,
}: {
  open: boolean;
  keepMounted?: boolean;
}) {
  const motion = useMatchDetailsMotion(open, keepMounted);
  return (
    <div data-testid="match-details-frame" style={{ height: motion.height }}>
      {motion.mounted && <div ref={motion.contentRef}>Scoreboard</div>}
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  contentHeight = 320;
  resizeCallbacks = [];
  disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 800, contentHeight),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('measures the first opening and follows content arriving after the loading state', () => {
  const view = render(<MatchDetailsHarness open={false} />);
  const frame = screen.getByTestId('match-details-frame');
  expect(frame).toHaveStyle({ height: '0px' });
  expect(screen.queryByText('Scoreboard')).toBeNull();

  view.rerender(<MatchDetailsHarness open />);
  expect(frame).toHaveStyle({ height: '320px' });
  contentHeight = 880;
  act(() => resizeCallbacks[0]());
  expect(frame).toHaveStyle({ height: '880px' });

  view.rerender(<MatchDetailsHarness open={false} />);
  expect(frame).toHaveStyle({ height: '0px' });
  expect(screen.getByText('Scoreboard')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(249));
  expect(screen.getByText('Scoreboard')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByText('Scoreboard')).toBeNull();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('cancels the pending removal when reopened during the closing transition', () => {
  const view = render(<MatchDetailsHarness open />);
  view.rerender(<MatchDetailsHarness open={false} />);
  act(() => vi.advanceTimersByTime(100));
  view.rerender(<MatchDetailsHarness open />);
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByText('Scoreboard')).toBeInTheDocument();
  expect(screen.getByTestId('match-details-frame')).toHaveStyle({ height: '320px' });
});

it('prepares retained content outside the click path and releases it when evicted', () => {
  const view = render(<MatchDetailsHarness open={false} keepMounted />);
  expect(screen.queryByText('Scoreboard')).toBeNull();
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByText('Scoreboard')).toBeInTheDocument();
  expect(screen.getByTestId('match-details-frame')).toHaveStyle({ height: '0px' });
  view.rerender(<MatchDetailsHarness open keepMounted />);
  view.rerender(<MatchDetailsHarness open={false} keepMounted />);
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText('Scoreboard')).toBeInTheDocument();
  view.rerender(<MatchDetailsHarness open={false} />);
  act(() => vi.advanceTimersByTime(250));
  expect(screen.queryByText('Scoreboard')).toBeNull();
});

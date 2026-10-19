import { Component, type ReactNode } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
export class ChartBoundary extends Component<
  { children: ReactNode; fallback: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Alert>
        <AlertDescription>{this.props.fallback}</AlertDescription>
      </Alert>
    ) : (
      this.props.children
    );
  }
}

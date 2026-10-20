import { Component, type ReactNode } from 'react';

/** An optional graph must never unmount a workout if its code is unavailable. */
export class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p className="py-4 text-sm text-zinc-400">График пока недоступен. Значения нагрузки показаны ниже.</p> : this.props.children;
  }
}

/** Ctrl+Shift+L overlay (SPEC 12): pipeline state, hash distance, timings. */

import type { Mode, PipelineStateName } from '../../shared/types';
import type { Diagnostics } from '../store';

export interface DebugProps {
  mode: Mode;
  pipeline: PipelineStateName;
  shushUntil: number | null;
  diagnostics: Diagnostics | null;
}

export function Debug(props: DebugProps): JSX.Element {
  const rows: Array<[string, string]> = [
    ['mode', props.mode],
    ['pipeline', props.pipeline],
    ['shush', props.shushUntil ? new Date(props.shushUntil).toLocaleTimeString() : '—'],
    ['capture', props.diagnostics?.captureActive ? 'active' : 'stopped'],
    ['protected', props.diagnostics?.protectionVerified ? 'yes' : 'NO'],
    ['hash Δ', String(props.diagnostics?.lastHashDistance ?? '—')],
    ['last request', props.diagnostics?.lastRequestMs ? `${props.diagnostics.lastRequestMs}ms` : '—'],
  ];
  return (
    <dl className="debug" aria-label="Debug overlay">
      {rows.map(([label, value]) => (
        <div key={label} className="debug__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

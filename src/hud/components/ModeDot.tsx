/** The whole status vocabulary in one 8px dot (SPEC 9). */

import type { Mode, PipelineStateName } from '../../shared/types';

export interface ModeDotProps {
  mode: Mode;
  pipeline: PipelineStateName;
  lowConfidence: boolean;
}

const LABELS: Record<string, string> = {
  off: 'Off',
  manual: 'Manual',
  armed: 'Auto, armed',
  held: 'Result ready to reveal',
  error: 'Error',
};

function tone(props: ModeDotProps): keyof typeof LABELS {
  if (props.pipeline === 'error') return 'error';
  if (props.mode === 'off') return 'off';
  if (props.pipeline === 'held') return 'held';
  if (props.mode === 'manual') return 'manual';
  return 'armed';
}

export function ModeDot(props: ModeDotProps): JSX.Element {
  const state = tone(props);
  return (
    <span
      className={`mode-dot mode-dot--${state}${props.lowConfidence ? ' mode-dot--badge' : ''}`}
      role="img"
      aria-label={LABELS[state]}
    />
  );
}

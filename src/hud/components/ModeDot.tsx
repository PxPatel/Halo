/** The whole status vocabulary in one dot (SPEC 9). */

export type Tone = 'off' | 'manual' | 'armed' | 'held' | 'error';

const LABELS: Record<Tone, string> = {
  off: 'Off',
  manual: 'Manual',
  armed: 'Auto, armed',
  held: 'Result ready to reveal',
  error: 'Error',
};

export interface ModeDotProps {
  tone: Tone;
  lowConfidence: boolean;
}

export function ModeDot(props: ModeDotProps): JSX.Element {
  return (
    <span
      className={`dot dot--${props.tone}${props.lowConfidence ? ' dot--badge' : ''}`}
      role="img"
      aria-label={LABELS[props.tone]}
    />
  );
}

/** The collapsed HUD: a dot, a word, and at most one hint. */

import { Kbd } from './Kbd';
import { ModeDot, type Tone } from './ModeDot';

export interface PillProps {
  tone: Tone;
  status: string;
  lowConfidence: boolean;
  /** Shown when a result is waiting: the chord that reveals it. */
  revealChord?: string;
  shushMinutesLeft: number | null;
}

export function Pill(props: PillProps): JSX.Element {
  return (
    <div className="pill surface" role="status" aria-live="polite">
      <ModeDot tone={props.tone} lowConfidence={props.lowConfidence} />
      <span className="pill__label">{props.status}</span>
      {props.tone === 'held' && props.revealChord && <Kbd chord={props.revealChord} />}
      {props.shushMinutesLeft !== null && (
        <span className="pill__meta">{props.shushMinutesLeft}m</span>
      )}
    </div>
  );
}

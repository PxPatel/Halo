/** The collapsed HUD: 180x36, a dot and a word. */

import type { Mode, PipelineStateName } from '../../shared/types';
import { ModeDot } from './ModeDot';

export interface PillProps {
  mode: Mode;
  pipeline: PipelineStateName;
  status: string;
  lowConfidence: boolean;
  shushMinutesLeft: number | null;
}

export function Pill(props: PillProps): JSX.Element {
  return (
    <div className="pill" role="status" aria-live="polite">
      <ModeDot mode={props.mode} pipeline={props.pipeline} lowConfidence={props.lowConfidence} />
      <span className="pill__status">{props.status}</span>
      {props.shushMinutesLeft !== null && (
        <span className="pill__meta">{props.shushMinutesLeft}m</span>
      )}
    </div>
  );
}

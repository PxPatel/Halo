/**
 * Incremental markdown section parser (SPEC 4, "Section streaming").
 *
 * The generation model answers with three fixed headers - `## Code`,
 * `## Notes`, `## Say` - rather than JSON, so the first token arrives sooner.
 * This parser is called again on every streamed chunk, so it must be cheap,
 * tolerant of truncation (including truncation part-way through a header),
 * and tolerant of sections that never appear at all.
 */

import { SECTION_KEYS, type SectionKey, type Sections } from './types';

const HEADER = /^ {0,3}#{1,6} *(code|notes|say) *:? *$/i;
const FENCE = /^ {0,3}(?:```|~~~)/;
/** A trailing line that may still be growing into a header. */
const MAYBE_HEADER = /^ {0,3}#/;

function joinTrimmed(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

export function parseSections(partial: string): Sections {
  const lines = partial.split('\n');

  // The final line of a stream is usually incomplete. If it could still grow
  // into a header, hold it back rather than emitting "## No" as body text.
  if (!partial.endsWith('\n') && lines.length > 0) {
    if (MAYBE_HEADER.test(lines[lines.length - 1]!)) lines.pop();
  }

  const buffers: Record<SectionKey, string[]> = { code: [], notes: [], say: [] };
  const preamble: string[] = [];
  let current: SectionKey | null = null;
  let sawHeader = false;
  let inFence = false;

  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;

    if (!inFence) {
      const match = HEADER.exec(line);
      if (match) {
        sawHeader = true;
        current = match[1]!.toLowerCase() as SectionKey;
        continue;
      }
    }

    if (current) buffers[current].push(line);
    else preamble.push(line);
  }

  const sections: Sections = {};

  // A model that ignored the contract still has something worth showing.
  if (!sawHeader) {
    const text = joinTrimmed(preamble);
    if (text) sections.notes = text;
    return sections;
  }

  for (const key of SECTION_KEYS) {
    const text = joinTrimmed(buffers[key]);
    if (text) sections[key] = text;
  }
  return sections;
}

/** Section order for tab rendering; absent sections are omitted by the caller. */
export function presentSections(sections: Sections): SectionKey[] {
  return SECTION_KEYS.filter((key) => Boolean(sections[key]));
}

import { describe, expect, it } from 'vitest';
import { parseSections, presentSections } from '../src/shared/sections';

const FULL = [
  '## Code',
  '',
  '```python',
  'def two_sum(nums, target):',
  '    return []',
  '```',
  '',
  '## Notes',
  '',
  '- Hash map of complements.',
  '- O(n) time, O(n) space.',
  '',
  '## Say',
  '',
  '- I will use a hash map.',
  '- That gives linear time.',
  '',
].join('\n');

describe('parseSections', () => {
  it('splits the three sections', () => {
    const sections = parseSections(FULL);
    expect(sections.code).toContain('def two_sum');
    expect(sections.notes).toContain('Hash map of complements.');
    expect(sections.say).toContain('I will use a hash map.');
    expect(presentSections(sections)).toEqual(['code', 'notes', 'say']);
  });

  it('omits sections that never arrive', () => {
    const sections = parseSections('## Notes\n\nBe specific.\n\n## Say\n\n- Keep it short.\n');
    expect(sections.code).toBeUndefined();
    expect(presentSections(sections)).toEqual(['notes', 'say']);
  });

  it('never emits a partial header as body text', () => {
    const sections = parseSections('## Notes\n\n- A point.\n## Sa');
    expect(sections.notes).toBe('- A point.');
    expect(sections.say).toBeUndefined();
  });

  it('parses incrementally without losing or inventing content', () => {
    for (let length = 1; length <= FULL.length; length += 1) {
      const partial = parseSections(FULL.slice(0, length));
      for (const [key, value] of Object.entries(partial)) {
        expect(value.length).toBeGreaterThan(0);
        expect(FULL).toContain(value.split('\n')[0]);
        expect(key).toMatch(/^(code|notes|say)$/);
      }
    }
    expect(parseSections(FULL.slice(0, FULL.indexOf('## Say')))).toMatchObject({
      code: expect.stringContaining('def two_sum'),
      notes: expect.stringContaining('O(n) time'),
    });
  });

  it('grows a section monotonically as chunks arrive', () => {
    const first = parseSections('## Notes\n\n- One');
    const second = parseSections('## Notes\n\n- One\n- Two\n');
    expect(second.notes?.startsWith(first.notes ?? '')).toBe(true);
  });

  it('does not treat a header inside a fenced block as a header', () => {
    const sections = parseSections('## Code\n\n```md\n## Say\nnot a header\n```\n');
    expect(sections.say).toBeUndefined();
    expect(sections.code).toContain('## Say');
  });

  it('tolerates a model that ignored the contract', () => {
    const sections = parseSections('Just an answer, no headers at all.');
    expect(sections.notes).toBe('Just an answer, no headers at all.');
    expect(sections.code).toBeUndefined();
  });

  it('accepts loose header formatting', () => {
    const sections = parseSections('### Notes:\nBody\n#### SAY\nAloud\n');
    expect(sections.notes).toBe('Body');
    expect(sections.say).toBe('Aloud');
  });

  it('returns nothing for empty input', () => {
    expect(parseSections('')).toEqual({});
    expect(presentSections(parseSections(''))).toEqual([]);
  });
});

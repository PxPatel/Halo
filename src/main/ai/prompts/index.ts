/**
 * Prompts are files, not string literals (SPEC 15). They are inlined at build
 * time so the packaged app has no runtime path resolution to get wrong, and
 * they still diff cleanly as markdown.
 */

import { readFileSync, statSync } from 'node:fs';
import classifyPrompt from './classify.md?raw';
import generateTemplate from './generate.md?raw';
import systemPrompt from './system.md?raw';

export const CLASSIFY_PROMPT: string = classifyPrompt.trim();
export const SYSTEM_PROMPT: string = systemPrompt.trim();

export interface GenerateVars {
  category?: string;
  userPrompt?: string;
  previous?: string;
}

const SECTION = /\{\{([#^])(\w+)\}\}\n?([\s\S]*?)\{\{\/\2\}\}\n?/g;
const VALUE = /\{\{(\w+)\}\}/g;

/**
 * Just enough templating for the prompt files: `{{#key}}...{{/key}}` keeps a
 * block when the value is present, `{{^key}}...{{/key}}` when it is absent,
 * and `{{key}}` interpolates.
 */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  const withSections = template.replace(SECTION, (_match, kind: string, key: string, body: string) => {
    const present = Boolean(vars[key]);
    const keep = kind === '#' ? present : !present;
    return keep ? body : '';
  });
  return withSections
    .replace(VALUE, (_match, key: string) => vars[key] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildGenerateMessage(vars: GenerateVars): string {
  return renderTemplate(generateTemplate, {
    category: vars.category,
    userPrompt: vars.userPrompt,
    previous: vars.previous,
  });
}

/** Max size of the user's script file; a runaway file would blow the cache. */
const MAX_SCRIPT_BYTES = 256 * 1024;

/**
 * The user's script (SPEC 11): one markdown file, read once at session start
 * and injected into the cached system prompt block.
 */
export function readScriptFile(path: string | null): string | null {
  if (!path) return null;
  try {
    if (statSync(path).size > MAX_SCRIPT_BYTES) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

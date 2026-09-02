/**
 * Just enough markdown for what the model is asked to produce: fenced code,
 * bullets, short headings, inline code and bold. Nothing is rendered as HTML,
 * so model output can never inject markup.
 */

import { Fragment } from 'react';
import { CodeBlock } from './CodeBlock';

type Block =
  | { kind: 'code'; language: string; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string };

const FENCE = /^ {0,3}(?:```|~~~)\s*(\S+)?/;
const BULLET = /^ {0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^ {0,3}\d+[.)]\s+(.*)$/;
const HEADING = /^ {0,3}#{1,6}\s+(.*)$/;

export function toBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
    if (list.length > 0) {
      blocks.push({ kind: 'list', items: list });
      list = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: 'code', language: fence[1] ?? 'text', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]! });
      continue;
    }
    const bullet = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (bullet) {
      if (paragraph.length > 0) flush();
      list.push(bullet[1]!);
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (list.length > 0) list[list.length - 1] += ` ${line.trim()}`;
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function inline(text: string, keyPrefix: string): JSX.Element {
  const parts = text.split(INLINE).filter((part) => part !== '');
  return (
    <>
      {parts.map((part, index) => {
        const key = `${keyPrefix}-${index}`;
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={key}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        }
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

export function Markdown({ source }: { source: string }): JSX.Element {
  return (
    <>
      {toBlocks(source).map((block, index) => {
        const key = `block-${index}`;
        switch (block.kind) {
          case 'code':
            return <CodeBlock key={key} code={block.text} language={block.language} />;
          case 'heading':
            return (
              <h4 key={key} className="md-heading">
                {inline(block.text, key)}
              </h4>
            );
          case 'list':
            return (
              <ul key={key} className="md-list">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={key} className="md-paragraph">
                {inline(block.text, key)}
              </p>
            );
        }
      })}
    </>
  );
}

/**
 * Syntax highlighting via shiki, with the plain text as the fallback.
 *
 * The highlighter is built from an explicit language list rather than shiki's
 * full bundle: the full bundle drags every grammar it knows about into the
 * package, which is several hundred chunks for a 420px card.
 */

import { useEffect, useState } from 'react';
import { createHighlighterCore, createJavaScriptRegexEngine, type HighlighterCore } from 'shiki/core';
import bash from 'shiki/langs/bash.mjs';
import cpp from 'shiki/langs/cpp.mjs';
import go from 'shiki/langs/go.mjs';
import java from 'shiki/langs/java.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import python from 'shiki/langs/python.mjs';
import rust from 'shiki/langs/rust.mjs';
import sql from 'shiki/langs/sql.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import theme from 'shiki/themes/github-dark-default.mjs';

const LANGS = { bash, cpp, go, java, javascript, json, python, rust, sql, tsx, typescript };

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  'c++': 'cpp',
  c: 'cpp',
  sh: 'bash',
  shell: 'bash',
  golang: 'go',
  jsx: 'tsx',
  kotlin: 'java',
};

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [theme],
    langs: Object.values(LANGS),
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

export function resolveLanguage(language: string): string | null {
  const key = (ALIASES[language.toLowerCase()] ?? language.toLowerCase()).trim();
  return key in LANGS ? key : null;
}

export interface CodeBlockProps {
  code: string;
  language: string;
  onCopy?: (code: string) => void;
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lang = resolveLanguage(props.language);

  useEffect(() => {
    let live = true;
    if (!lang) {
      setHtml(null);
      return;
    }
    getHighlighter()
      .then((instance) => {
        if (live) setHtml(instance.codeToHtml(props.code, { lang, theme: 'github-dark-default' }));
      })
      .catch(() => {
        if (live) setHtml(null);
      });
    return () => {
      live = false;
    };
  }, [props.code, lang]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <figure className="code">
      <figcaption className="code__head">
        <span className="code__lang">{lang ?? props.language ?? 'text'}</span>
        {props.onCopy && (
          <button
            type="button"
            className="code__copy"
            onClick={() => {
              props.onCopy?.(props.code);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </figcaption>
      {html === null ? (
        <pre className="code__body">
          <code>{props.code}</code>
        </pre>
      ) : (
        // shiki escapes the code it renders; nothing else is injected here.
        <div className="code__body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </figure>
  );
}

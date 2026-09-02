/**
 * The only place the Anthropic SDK is imported.
 *
 * Prompt caching: the system prompt and the user's script are static for the
 * whole session, carry `cache_control` with the 1h TTL, and come first. The
 * image and the user's prompt are dynamic and come last. Getting that order
 * wrong silently disables the cache (SPEC 7).
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AI, MODELS } from '../../shared/constants';
import { CATEGORIES, type Classification } from '../../shared/types';
import { log } from '../log';
import {
  NOT_ACTIONABLE,
  ProviderError,
  type ClassifyInput,
  type GenerateChunk,
  type GenerateInput,
  type ModelProvider,
} from './ModelProvider';
import { buildGenerateMessage, CLASSIFY_PROMPT, SYSTEM_PROMPT } from './prompts';

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const ClassificationSchema = z.object({
  actionable: z.boolean(),
  category: z.enum(CATEGORIES as unknown as [string, ...string[]]),
  confidence: z.number().min(0).max(1),
  region: RectSchema.optional(),
});

export interface AnthropicProviderOptions {
  apiKey: string;
  models?: { classify: string; generate: string };
  /** The user's script file, already read. Static for the session. */
  script?: string | null;
}

type SystemBlocks = Anthropic.Messages.TextBlockParam[];

function cached(blocks: SystemBlocks): SystemBlocks {
  const last = blocks[blocks.length - 1];
  if (last) last.cache_control = { type: 'ephemeral', ttl: AI.cacheTtl };
  return blocks;
}

/** Models answer with JSON; some of them wrap it in a fence anyway. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError('Check your API key', 'auth', false);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError('Rate limited', 'rate', true);
  }
  if (error instanceof Anthropic.APIError) {
    const overloaded = error.status === 529 || (error.status ?? 0) >= 500;
    return new ProviderError(
      overloaded ? 'The model is overloaded' : `API error ${error.status ?? '?'}`,
      overloaded ? 'overloaded' : 'unknown',
      overloaded,
    );
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderError('Request aborted', 'timeout', true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Network unavailable', 'network', true);
  }
  return new ProviderError(error instanceof Error ? error.message : 'Unknown error', 'unknown', false);
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ProviderError('Request aborted', 'timeout', true));
      },
      { once: true },
    );
  });

export class AnthropicProvider implements ModelProvider {
  private readonly client: Anthropic;
  private readonly models: { classify: string; generate: string };
  private readonly system: SystemBlocks;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // Retries are ours: SPEC 12 specifies two, with backoff, on 429/529 only.
      maxRetries: 0,
    });
    this.models = options.models ?? { classify: MODELS.classify, generate: MODELS.generate };
    const blocks: SystemBlocks = [{ type: 'text', text: SYSTEM_PROMPT }];
    if (options.script?.trim()) {
      blocks.push({ type: 'text', text: `# The user's script\n\n${options.script.trim()}` });
    }
    this.system = cached(blocks);
  }

  async warmup(): Promise<void> {
    try {
      await this.client.messages.create({
        model: this.models.generate,
        max_tokens: 1,
        system: this.system,
        messages: [{ role: 'user', content: 'ok' }],
        thinking: { type: 'disabled' },
      });
      log.info('ai', 'warmup complete');
    } catch (error) {
      log.warn('ai', `warmup failed: ${toProviderError(error).message}`);
    }
  }

  async classify(input: ClassifyInput, signal: AbortSignal): Promise<Classification> {
    const response = await this.withRetry(
      () =>
        this.client.messages.create(
          {
            model: this.models.classify,
            max_tokens: AI.classifyMaxTokens,
            temperature: 0,
            system: cached([{ type: 'text', text: CLASSIFY_PROMPT }]),
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: input.image.mediaType,
                      data: input.image.base64,
                    },
                  },
                ],
              },
            ],
          },
          { signal },
        ),
      signal,
    );

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const parsed = ClassificationSchema.safeParse(extractJson(text));
    if (!parsed.success) {
      log.warn('ai', 'classification JSON unparseable, treating as not actionable');
      return NOT_ACTIONABLE;
    }
    return parsed.data as Classification;
  }

  async *generate(input: GenerateInput, signal: AbortSignal): AsyncIterable<GenerateChunk> {
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    if (input.image) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.image.mediaType,
          data: input.image.base64,
        },
      });
    }
    content.push({
      type: 'text',
      text: buildGenerateMessage({
        category: input.category,
        userPrompt: input.userPrompt,
        previous: input.previousRaw,
      }),
    });

    let raw = '';
    let attempt = 0;
    for (;;) {
      try {
        const stream = this.client.messages.stream(
          {
            model: this.models.generate,
            max_tokens: AI.generateMaxTokens,
            system: this.system,
            messages: [{ role: 'user', content }],
            // First token latency is the product (SPEC 14, M1); thinking would
            // put seconds in front of it.
            thinking: { type: 'disabled' },
          },
          { signal },
        );
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            raw += event.delta.text;
            yield { type: 'text', text: event.delta.text };
          }
        }
        yield { type: 'done', raw };
        return;
      } catch (error) {
        const failure = toProviderError(error);
        const canRetry = failure.retryable && raw === '' && attempt < AI.retries && !signal.aborted;
        if (!canRetry) throw failure;
        attempt += 1;
        await sleep(AI.retryBaseMs * 2 ** (attempt - 1), signal);
      }
    }
  }

  private async withRetry<T>(call: () => Promise<T>, signal: AbortSignal): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await call();
      } catch (error) {
        const failure = toProviderError(error);
        if (!failure.retryable || attempt >= AI.retries || signal.aborted) throw failure;
        attempt += 1;
        await sleep(AI.retryBaseMs * 2 ** (attempt - 1), signal);
      }
    }
  }
}

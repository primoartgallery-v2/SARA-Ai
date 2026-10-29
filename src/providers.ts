/**
 * SARA AI — Provider Abstraction Layer (Phase A2 / A3)
 *
 * Implements a unified AI provider interface supporting:
 *  - CloudflareAIProvider (Native Cloudflare Workers AI)
 *  - OmniRouteProvider (OpenAI-compatible local gateway)
 *  - ResilientAIProvider (Controlled, quota-safe failover wrapper)
 *
 * SARA's prompt builder, personality, memory, documents, web context,
 * and context budgeting remain fully owned by SARA before reaching this layer.
 */

export type SaraModelMode = 'fast' | 'smart' | 'thinking';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  mode: SaraModelMode;
  customModel?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface CompleteOptions {
  messages: ChatMessage[];
  mode?: SaraModelMode;
  customModel?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  readonly name: string;
  streamChat(options: StreamChatOptions): Promise<ReadableStream<string>>;
  complete(options: CompleteOptions): Promise<string>;
}

export class ProviderError extends Error {
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly code: string;

  constructor(message: string, options: { provider: string; statusCode?: number; code?: string }) {
    super(message);
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.code = options.code || 'PROVIDER_ERROR';
  }
}

export const DEFAULT_OMNIROUTE_MODELS = {
  fast: 'auto/fast',
  smart: 'auto/smart',
  thinking: 'auto/reasoning',
  summarizer: 'auto/best-free'
} as const;

export const DEFAULT_CLOUDFLARE_MODELS = {
  fast: '@cf/zai-org/glm-4.7-flash',
  smart: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  thinking: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  summarizer: '@cf/zai-org/glm-4.7-flash'
} as const;

/**
 * Safely parses a single line from an OpenAI-compatible SSE stream.
 * Extracts `choices[0].delta.content`.
 */
export function parseOpenAISSELine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) {
    return null;
  }
  const dataStr = trimmed.slice(5).trim();
  if (!dataStr || dataStr === '[DONE]') {
    return null;
  }
  try {
    const parsed = JSON.parse(dataStr);
    const content = parsed.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content.length > 0) {
      return content;
    }
    return null;
  } catch {
    // Malformed JSON chunk: skip safely
    return null;
  }
}

/**
 * Converts an OpenAI-compatible SSE byte stream into a pure string token stream.
 * Handles split network chunks, multi-event frames, blank lines, UTF-8 boundaries, and abort signals.
 */
export function createOpenAITokenStream(
  byteStream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): ReadableStream<string> {
  const dec = new TextDecoder('utf-8');
  let buffer = '';
  const reader = byteStream.getReader();

  return new ReadableStream<string>({
    async pull(controller) {
      try {
        if (signal?.aborted) {
          controller.close();
          reader.cancel().catch(() => {});
          return;
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const lines = buffer.split('\n');
              for (const line of lines) {
                const token = parseOpenAISSELine(line);
                if (token) controller.enqueue(token);
              }
              buffer = '';
            }
            controller.close();
            return;
          }

          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let enqueuedAny = false;
          for (const line of lines) {
            const token = parseOpenAISSELine(line);
            if (token) {
              controller.enqueue(token);
              enqueuedAny = true;
            }
          }

          if (enqueuedAny) {
            return;
          }
        }
      } catch (err: any) {
        if (signal?.aborted || err?.name === 'AbortError') {
          try { controller.close(); } catch {}
          return;
        }
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    }
  });
}

/**
 * Safely parses a single line from a Cloudflare Workers AI SSE stream.
 * Extracts `parsed.response || ''`.
 */
export function parseCloudflareSSELine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) {
    return null;
  }
  const dataStr = trimmed.slice(5).trim();
  if (!dataStr || dataStr === '[DONE]') {
    return null;
  }
  try {
    const parsed = JSON.parse(dataStr);
    const text = parsed.response;
    if (typeof text === 'string' && text.length > 0) {
      return text;
    }
    return null;
  } catch {
    return dataStr.length > 0 ? dataStr : null;
  }
}

/**
 * Converts a Cloudflare Workers AI SSE byte stream into a pure string token stream.
 */
export function createCloudflareTokenStream(
  byteStream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): ReadableStream<string> {
  const dec = new TextDecoder('utf-8');
  let buffer = '';
  const reader = byteStream.getReader();

  return new ReadableStream<string>({
    async pull(controller) {
      try {
        if (signal?.aborted) {
          controller.close();
          reader.cancel().catch(() => {});
          return;
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              const lines = buffer.split('\n');
              for (const line of lines) {
                const token = parseCloudflareSSELine(line);
                if (token) controller.enqueue(token);
              }
              buffer = '';
            }
            controller.close();
            return;
          }

          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let enqueuedAny = false;
          for (const line of lines) {
            const token = parseCloudflareSSELine(line);
            if (token) {
              controller.enqueue(token);
              enqueuedAny = true;
            }
          }

          if (enqueuedAny) {
            return;
          }
        }
      } catch (err: any) {
        if (signal?.aborted || err?.name === 'AbortError') {
          try { controller.close(); } catch {}
          return;
        }
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    }
  });
}

export class CloudflareAIProvider implements AIProvider {
  public readonly name = 'cloudflare';
  private readonly ai: any;
  private readonly envModels: {
    fast?: string;
    smart?: string;
    thinking?: string;
    summarizer?: string;
  };

  constructor(ai: any, envModels?: { fast?: string; smart?: string; thinking?: string; summarizer?: string }) {
    this.ai = ai;
    this.envModels = envModels || {};
  }

  private resolveModel(mode: SaraModelMode, customModel?: string): string {
    if (customModel) return customModel;
    if (mode === 'thinking') {
      return this.envModels.thinking || DEFAULT_CLOUDFLARE_MODELS.thinking;
    }
    if (mode === 'fast') {
      return this.envModels.fast || DEFAULT_CLOUDFLARE_MODELS.fast;
    }
    return this.envModels.smart || DEFAULT_CLOUDFLARE_MODELS.smart;
  }

  async streamChat(options: StreamChatOptions): Promise<ReadableStream<string>> {
    if (!this.ai || typeof this.ai.run !== 'function') {
      throw new ProviderError('Cloudflare AI binding (env.AI) is unavailable.', {
        provider: this.name,
        code: 'AI_BINDING_MISSING'
      });
    }

    const model = this.resolveModel(options.mode, options.customModel);
    try {
      const responseStream = await this.ai.run(model, {
        messages: options.messages,
        stream: true,
        max_tokens: options.maxTokens || 3072,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
      });
      return createCloudflareTokenStream(responseStream as ReadableStream<Uint8Array>, options.signal);
    } catch (err: any) {
      throw new ProviderError(`Cloudflare Workers AI generation failed: ${err.message || 'Unknown error'}`, {
        provider: this.name,
        code: 'CLOUDFLARE_AI_ERROR'
      });
    }
  }

  async complete(options: CompleteOptions): Promise<string> {
    if (!this.ai || typeof this.ai.run !== 'function') {
      throw new ProviderError('Cloudflare AI binding (env.AI) is unavailable.', {
        provider: this.name,
        code: 'AI_BINDING_MISSING'
      });
    }

    const model = options.customModel || this.resolveModel(options.mode || 'fast', options.customModel);
    try {
      const res = await this.ai.run(model, {
        messages: options.messages,
        max_tokens: options.maxTokens || 1024,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
      });
      return (res?.response || (typeof res === 'string' ? res : '') || '').trim();
    } catch (err: any) {
      throw new ProviderError(`Cloudflare Workers AI complete failed: ${err.message || 'Unknown error'}`, {
        provider: this.name,
        code: 'CLOUDFLARE_AI_ERROR'
      });
    }
  }
}

export interface OmniRouteConfig {
  baseUrl?: string;
  apiKey?: string;
  models?: {
    fast?: string;
    smart?: string;
    thinking?: string;
    summarizer?: string;
  };
}

export class OmniRouteProvider implements AIProvider {
  public readonly name = 'omniroute';
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly models: {
    fast: string;
    smart: string;
    thinking: string;
    summarizer: string;
  };

  constructor(config?: OmniRouteConfig) {
    const rawUrl = (config?.baseUrl || 'http://127.0.0.1:20128/v1').trim();
    this.baseUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
    this.apiKey = config?.apiKey?.trim();
    this.models = {
      fast: config?.models?.fast || DEFAULT_OMNIROUTE_MODELS.fast,
      smart: config?.models?.smart || DEFAULT_OMNIROUTE_MODELS.smart,
      thinking: config?.models?.thinking || DEFAULT_OMNIROUTE_MODELS.thinking,
      summarizer: config?.models?.summarizer || DEFAULT_OMNIROUTE_MODELS.summarizer
    };
  }

  private resolveModel(mode: SaraModelMode, customModel?: string): string {
    if (customModel) return customModel;
    if (mode === 'thinking') return this.models.thinking;
    if (mode === 'fast') return this.models.fast;
    return this.models.smart;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  public normalizeError(status: number, statusText: string, rawBody?: string): ProviderError {
    let detail = '';
    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody);
        detail = parsed.error?.message || parsed.message || '';
      } catch {
        detail = rawBody.slice(0, 200);
      }
    }

    if (status === 401 || status === 403) {
      return new ProviderError('OmniRoute authentication failed. Verify OMNIROUTE_API_KEY in local configuration.', {
        provider: this.name,
        statusCode: status,
        code: 'AUTH_FAILED'
      });
    }
    if (status === 404) {
      return new ProviderError(`Requested OmniRoute route or model was not found: ${detail || statusText}`, {
        provider: this.name,
        statusCode: status,
        code: 'MODEL_NOT_FOUND'
      });
    }
    if (status === 429) {
      return new ProviderError(`OmniRoute provider quota or rate limit exceeded: ${detail || statusText}`, {
        provider: this.name,
        statusCode: status,
        code: 'RATE_LIMITED'
      });
    }
    if (status >= 500) {
      return new ProviderError(`OmniRoute upstream provider error (${status}): ${detail || statusText}`, {
        provider: this.name,
        statusCode: status,
        code: 'UPSTREAM_ERROR'
      });
    }
    return new ProviderError(`OmniRoute request failed (${status}): ${detail || statusText}`, {
      provider: this.name,
      statusCode: status,
      code: 'REQUEST_FAILED'
    });
  }

  async streamChat(options: StreamChatOptions): Promise<ReadableStream<string>> {
    if (!this.apiKey) {
      throw new ProviderError('OMNIROUTE_API_KEY is not configured in local environment.', {
        provider: this.name,
        code: 'API_KEY_MISSING'
      });
    }

    const model = this.resolveModel(options.mode, options.customModel);
    const endpoint = `${this.baseUrl}/chat/completions`;

    const requestBody = {
      model,
      messages: options.messages,
      stream: true,
      max_tokens: options.maxTokens || 3072,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: options.signal
      });
    } catch (err: any) {
      if (options.signal?.aborted || err?.name === 'AbortError') {
        throw err;
      }
      throw new ProviderError(
        `Failed to reach OmniRoute at ${this.baseUrl} (is OmniRoute running?): ${err.message || 'Connection error'}`,
        {
          provider: this.name,
          code: 'CONNECTION_FAILED'
        }
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw this.normalizeError(response.status, response.statusText, errText);
    }

    if (!response.body) {
      throw new ProviderError('OmniRoute returned an empty response body.', {
        provider: this.name,
        code: 'EMPTY_RESPONSE'
      });
    }

    return createOpenAITokenStream(response.body, options.signal);
  }

  async complete(options: CompleteOptions): Promise<string> {
    if (!this.apiKey) {
      throw new ProviderError('OMNIROUTE_API_KEY is not configured in local environment.', {
        provider: this.name,
        code: 'API_KEY_MISSING'
      });
    }

    const model = options.customModel || (options.mode ? this.resolveModel(options.mode) : this.models.summarizer);
    const endpoint = `${this.baseUrl}/chat/completions`;

    const requestBody = {
      model,
      messages: options.messages,
      stream: false,
      max_tokens: options.maxTokens || 1024,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: options.signal
      });
    } catch (err: any) {
      if (options.signal?.aborted || err?.name === 'AbortError') {
        throw err;
      }
      throw new ProviderError(
        `Failed to reach OmniRoute at ${this.baseUrl}: ${err.message || 'Connection error'}`,
        {
          provider: this.name,
          code: 'CONNECTION_FAILED'
        }
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw this.normalizeError(response.status, response.statusText, errText);
    }

    const data: any = await response.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }
    return '';
  }
}

/**
 * Determines whether a given provider error is eligible for fallback to Cloudflare.
 * Step 11: User abort must NEVER failover.
 * Step 12: Auth failures (401/403) must NEVER failover.
 * Step 14: Approved errors: RATE_LIMITED, CONNECTION_FAILED, TIMEOUT, UPSTREAM_ERROR, MODEL_NOT_FOUND.
 */
export function isEligibleForFallback(error: any): boolean {
  if (!error) return false;
  // User abort must NEVER failover
  if (error.name === 'AbortError' || error.code === 'ABORTED') {
    return false;
  }
  if (error instanceof ProviderError) {
    // Auth failures must NEVER failover
    if (error.code === 'AUTH_FAILED' || error.statusCode === 401 || error.statusCode === 403) {
      return false;
    }
    // Missing local API key is a configuration failure, never failover
    if (error.code === 'API_KEY_MISSING') {
      return false;
    }
    // Approved errors for transient fallback
    const approvedCodes = ['RATE_LIMITED', 'CONNECTION_FAILED', 'MODEL_NOT_FOUND', 'UPSTREAM_ERROR', 'TIMEOUT', 'EMPTY_RESPONSE'];
    if (approvedCodes.includes(error.code)) {
      return true;
    }
    if (error.statusCode === 429 || (error.statusCode && error.statusCode >= 500) || error.statusCode === 404) {
      return true;
    }
  }
  return false;
}

export interface FallbackEvent {
  primaryProvider: string;
  fallbackProvider: string;
  reason: string;
  tokensEmittedBeforeFailure: number;
}

export type FallbackLogger = (event: FallbackEvent) => void;

/**
 * ResilientAIProvider wraps primary and secondary providers with controlled failover.
 * Enforces:
 *  - Fallback policy gating (off vs cloudflare)
 *  - Strict error qualification (Rate limit, connection, 5xx only)
 *  - Streaming safety: Fallback is ONLY permitted BEFORE meaningful tokens are emitted.
 *  - No recursive fallback loops (OmniRoute -> Cloudflare -> STOP).
 *  - Observability metadata logging without secret/content leaks.
 */
export class ResilientAIProvider implements AIProvider {
  public readonly name: string;
  private readonly primary: AIProvider;
  private readonly fallback: AIProvider | null;
  private readonly fallbackPolicy: 'off' | 'cloudflare';
  private readonly onFallback?: FallbackLogger;

  constructor(options: {
    primary: AIProvider;
    fallback?: AIProvider | null;
    fallbackPolicy?: string;
    onFallback?: FallbackLogger;
  }) {
    this.primary = options.primary;
    this.fallbackPolicy = options.fallbackPolicy === 'cloudflare' ? 'cloudflare' : 'off';
    this.fallback = this.fallbackPolicy === 'cloudflare' && options.fallback ? options.fallback : null;
    this.name = this.fallback ? `${this.primary.name}-with-fallback` : this.primary.name;
    this.onFallback = options.onFallback;
  }

  private logFallback(primary: string, fallback: string, reason: string, tokensEmitted: number) {
    console.info(`[SARA Failover] provider=${primary} fallback=true reason=${reason} final_provider=${fallback}`);
    if (this.onFallback) {
      this.onFallback({
        primaryProvider: primary,
        fallbackProvider: fallback,
        reason,
        tokensEmittedBeforeFailure: tokensEmitted
      });
    }
  }

  async streamChat(options: StreamChatOptions): Promise<ReadableStream<string>> {
    if (options.signal?.aborted) {
      throw new ProviderError('Request aborted by user before start.', {
        provider: this.primary.name,
        code: 'ABORTED'
      });
    }

    if (!this.fallback) {
      return this.primary.streamChat(options);
    }

    let primaryStream: ReadableStream<string>;
    try {
      primaryStream = await this.primary.streamChat(options);
    } catch (err: any) {
      if (isEligibleForFallback(err)) {
        this.logFallback(this.primary.name, this.fallback.name, err.code || 'INIT_FAILURE', 0);
        return this.fallback.streamChat(options);
      }
      throw err;
    }

    return this.wrapStreamWithFallbackSafety(primaryStream, options);
  }

  private wrapStreamWithFallbackSafety(
    primaryStream: ReadableStream<string>,
    options: StreamChatOptions
  ): ReadableStream<string> {
    const primaryReader = primaryStream.getReader();
    let tokensEmitted = 0;
    let fallbackStream: ReadableStream<string> | null = null;
    let fallbackReader: ReadableStreamDefaultReader<string> | null = null;
    const fallbackProvider = this.fallback;
    const logFallbackFn = this.logFallback.bind(this);
    const primaryName = this.primary.name;

    return new ReadableStream<string>({
      async pull(controller) {
        try {
          if (options.signal?.aborted) {
            controller.close();
            primaryReader.cancel().catch(() => {});
            if (fallbackReader) fallbackReader.cancel().catch(() => {});
            return;
          }

          if (fallbackReader) {
            const { done, value } = await fallbackReader.read();
            if (done) {
              controller.close();
              return;
            }
            if (value) controller.enqueue(value);
            return;
          }

          const { done, value } = await primaryReader.read();
          if (done) {
            controller.close();
            return;
          }

          if (value) {
            tokensEmitted++;
            controller.enqueue(value);
          }
        } catch (err: any) {
          if (options.signal?.aborted || err?.name === 'AbortError') {
            try { controller.close(); } catch {}
            return;
          }

          // Fallback allowed ONLY if 0 tokens emitted before failure
          if (tokensEmitted === 0 && !fallbackReader && fallbackProvider && isEligibleForFallback(err)) {
            logFallbackFn(primaryName, fallbackProvider.name, err?.code || 'STREAM_INIT_FAILURE', 0);
            try {
              fallbackStream = await fallbackProvider.streamChat(options);
              fallbackReader = fallbackStream.getReader();
              const { done, value } = await fallbackReader.read();
              if (done) {
                controller.close();
                return;
              }
              if (value) controller.enqueue(value);
              return;
            } catch (fallbackErr: any) {
              controller.error(fallbackErr);
              return;
            }
          }

          // If tokens already emitted, STOP stream safely without mid-stream provider restart
          console.warn(`[SARA Provider] Stream interrupted after ${tokensEmitted} tokens. Closing stream safely.`);
          try { controller.close(); } catch {}
        }
      },
      cancel(reason) {
        primaryReader.cancel(reason).catch(() => {});
        if (fallbackReader) fallbackReader.cancel(reason).catch(() => {});
      }
    });
  }

  async complete(options: CompleteOptions): Promise<string> {
    if (options.signal?.aborted) {
      throw new ProviderError('Request aborted by user.', {
        provider: this.primary.name,
        code: 'ABORTED'
      });
    }

    if (!this.fallback) {
      return this.primary.complete(options);
    }

    try {
      return await this.primary.complete(options);
    } catch (err: any) {
      if (isEligibleForFallback(err)) {
        this.logFallback(this.primary.name, this.fallback.name, err.code || 'COMPLETE_FAILURE', 0);
        return await this.fallback.complete(options);
      }
      throw err;
    }
  }
}

export function getProvider(env: any): AIProvider {
  const providerType = String(env?.AI_PROVIDER || 'cloudflare').toLowerCase().trim();
  const fallbackPolicy = String(env?.AI_FALLBACK_POLICY || 'off').toLowerCase().trim();

  const cloudflareProvider = new CloudflareAIProvider(env.AI, {
    fast: env.FAST_MODEL || DEFAULT_CLOUDFLARE_MODELS.fast,
    smart: env.DEFAULT_MODEL || DEFAULT_CLOUDFLARE_MODELS.smart,
    thinking: env.THINKING_MODEL || DEFAULT_CLOUDFLARE_MODELS.thinking,
    summarizer: env.FAST_MODEL || DEFAULT_CLOUDFLARE_MODELS.summarizer
  });

  if (providerType === 'omniroute') {
    const omnirouteProvider = new OmniRouteProvider({
      baseUrl: env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1',
      apiKey: env.OMNIROUTE_API_KEY,
      models: {
        fast: env.OMNIROUTE_FAST_MODEL || DEFAULT_OMNIROUTE_MODELS.fast,
        smart: env.OMNIROUTE_SMART_MODEL || DEFAULT_OMNIROUTE_MODELS.smart,
        thinking: env.OMNIROUTE_THINKING_MODEL || DEFAULT_OMNIROUTE_MODELS.thinking,
        summarizer: env.OMNIROUTE_SUMMARIZER_MODEL || DEFAULT_OMNIROUTE_MODELS.summarizer
      }
    });

    if (fallbackPolicy === 'cloudflare') {
      return new ResilientAIProvider({
        primary: omnirouteProvider,
        fallback: cloudflareProvider,
        fallbackPolicy: 'cloudflare'
      });
    }

    return omnirouteProvider;
  }

  return cloudflareProvider;
}

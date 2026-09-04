import type { LLMDecision, LLMProvider, RecentMessage, ToolDefinition } from '../agent/types.js';
import { buildSummarizationPrompt, buildSystemPrompt } from './prompts.js';

interface GeminiPart {
  text?: string;
  functionCall?: {
    name?: string;
    args?: unknown;
  };
}

interface GeminiContent {
  role?: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    message?: string;
    status?: string;
  };
}

export class GeminiProvider implements LLMProvider {
  constructor(private readonly options: {
    apiKey?: string;
    model: string;
    fallbackModels?: string[];
    endpoint?: string;
    timeoutMs?: number;
  }) {}

  async decide(input: Parameters<LLMProvider['decide']>[0]): Promise<LLMDecision> {
    const response = await this.generate({
      systemInstruction: buildSystemPrompt(input.timezone),
      contents: [
        ...toGeminiContents(input.recentMessages),
        { role: 'user', parts: [{ text: input.text }] }
      ],
      tools: input.tools.length > 0
        ? [{ functionDeclarations: input.tools.map(toGeminiFunctionDeclaration) }]
        : undefined
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const functionCall = parts.find((part) => part.functionCall)?.functionCall;
    if (functionCall?.name) {
      return {
        kind: 'tool',
        toolName: functionCall.name,
        toolInput: functionCall.args ?? {}
      };
    }

    const content = parts.map((part) => part.text).filter(Boolean).join('\n').trim();
    return {
      kind: 'final',
      content: content || "I'm not sure how to respond to that yet."
    };
  }

  async summarize(text: string, mode = 'summary'): Promise<string> {
    const response = await this.generate({
      systemInstruction: buildSummarizationPrompt(mode),
      contents: [{ role: 'user', parts: [{ text }] }]
    });

    const content = response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join('\n')
      .trim();
    return content || 'I could not summarize that content.';
  }

  private async generate(body: Record<string, unknown>): Promise<GeminiResponse> {
    const apiKey = this.options.apiKey;
    if (!apiKey) {
      throw new Error('Gemini provider is not configured');
    }

    const models = [
      this.options.model,
      ...(this.options.fallbackModels ?? [])
    ].filter((model, index, all) => all.indexOf(model) === index);
    let lastError: Error | undefined;

    for (const model of models) {
      try {
        return await this.generateWithModel(model, apiKey, body);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!isFallbackEligibleGeminiError(lastError)) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error('Gemini request failed');
  }

  private async generateWithModel(model: string, apiKey: string, body: Record<string, unknown>): Promise<GeminiResponse> {
    const endpoint = this.options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    const timeoutMs = this.options.timeoutMs ?? 20_000;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetch(`${endpoint}/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        signal: abortController.signal,
        body: JSON.stringify({
          ...body,
          systemInstruction: {
            parts: [{ text: body.systemInstruction }]
          }
        })
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json() as GeminiResponse;
    if (!response.ok) {
      throw new Error(`${response.status} ${payload.error?.message ?? response.statusText}`);
    }
    return payload;
  }
}

function isFallbackEligibleGeminiError(error: Error): boolean {
  return /^(429|500|502|503|504)\b/.test(error.message)
    || /^404\b/.test(error.message) && /no longer available|not found/i.test(error.message)
    || /^Gemini request timed out after \d+ms$/.test(error.message);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function toGeminiContents(messages: RecentMessage[]): GeminiContent[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));
}

function toGeminiFunctionDeclaration(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  };
}

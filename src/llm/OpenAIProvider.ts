import OpenAI, { toFile } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { LLMDecision, LLMProvider, ToolDefinition } from '../agent/types.js';
import { buildSummarizationPrompt, buildSystemPrompt } from './prompts.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  model: string;
  transcriptionModel?: string;
  timeoutMs?: number;
  /** For OpenAI-compatible APIs such as OpenRouter. */
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  /** Extra provider-specific fields merged into every chat completion request. */
  extraBody?: Record<string, unknown>;
}

export class OpenAIProvider implements LLMProvider {
  protected readonly client: OpenAI;

  constructor(protected readonly options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey || 'missing-key',
      baseURL: options.baseURL,
      defaultHeaders: options.defaultHeaders,
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 1
    });
  }

  async decide(input: Parameters<LLMProvider['decide']>[0]): Promise<LLMDecision> {
    if (!this.options.apiKey) {
      throw new Error('AI provider is not configured');
    }

    const response = await this.client.chat.completions.create({
      ...this.options.extraBody,
      model: this.options.model,
      messages: buildMessages(input.text, buildSystemPrompt(input.timezone, input.context), input.recentMessages),
      ...(input.tools.length > 0 ? { tools: input.tools.map(toOpenAITool), tool_choice: 'auto' as const } : {}),
      temperature: 0.2
    });
    const message = response.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (toolCall?.type === 'function') {
      return {
        kind: 'tool',
        toolName: toolCall.function.name,
        toolInput: JSON.parse(toolCall.function.arguments || '{}')
      };
    }
    return {
      kind: 'final',
      content: message?.content || "I'm not sure how to respond to that yet."
    };
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    if (!this.options.apiKey) {
      throw new Error('AI provider is not configured');
    }
    const extension = AUDIO_EXTENSIONS[mimeType] ?? 'ogg';
    const response = await this.client.audio.transcriptions.create({
      model: this.options.transcriptionModel ?? 'whisper-1',
      file: await toFile(audio, `voice-note.${extension}`, { type: mimeType })
    });
    return response.text.trim();
  }

  async summarize(text: string, mode = 'summary'): Promise<string> {
    if (!this.options.apiKey) {
      throw new Error('AI provider is not configured');
    }
    const response = await this.client.chat.completions.create({
      ...this.options.extraBody,
      model: this.options.model,
      messages: [
        {
          role: 'system',
          content: buildSummarizationPrompt(mode)
        },
        { role: 'user', content: text }
      ],
      temperature: 0.2
    });
    return response.choices[0]?.message?.content || 'I could not summarize that content.';
  }
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm'
};

function buildMessages(text: string, systemPrompt: string, recentMessages: Parameters<LLMProvider['decide']>[0]['recentMessages']): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: systemPrompt
    },
    ...recentMessages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          content: message.content,
          tool_call_id: message.toolCallId ?? '',
          name: message.name
        } as ChatCompletionMessageParam;
      }

      return {
        role: message.role,
        content: message.content,
        name: message.name
      } as ChatCompletionMessageParam;
    }),
    { role: 'user', content: text }
  ];
}

function toOpenAITool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>
    }
  };
}

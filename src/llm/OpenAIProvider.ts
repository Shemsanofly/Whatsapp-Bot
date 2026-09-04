import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { LLMDecision, LLMProvider, ToolDefinition } from '../agent/types.js';
import { buildSummarizationPrompt, buildSystemPrompt } from './prompts.js';

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;

  constructor(private readonly options: {
    apiKey?: string;
    model: string;
    timeoutMs?: number;
  }) {
    this.client = new OpenAI({
      apiKey: options.apiKey || 'missing-key',
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 1
    });
  }

  async decide(input: Parameters<LLMProvider['decide']>[0]): Promise<LLMDecision> {
    if (!this.options.apiKey) {
      throw new Error('AI provider is not configured');
    }

    const response = await this.client.chat.completions.create({
      model: this.options.model,
      messages: buildMessages(input.text, input.timezone, input.recentMessages),
      tools: input.tools.map(toOpenAITool),
      tool_choice: 'auto',
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

  async summarize(text: string, mode = 'summary'): Promise<string> {
    if (!this.options.apiKey) {
      throw new Error('AI provider is not configured');
    }
    const response = await this.client.chat.completions.create({
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

function buildMessages(text: string, timezone: string, recentMessages: Parameters<LLMProvider['decide']>[0]['recentMessages']): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: buildSystemPrompt(timezone)
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

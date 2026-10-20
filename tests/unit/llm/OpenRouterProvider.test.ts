import { describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../../src/llm/OpenRouterProvider.js';

const decideInput = (tools: Array<{ name: string; description: string; inputSchema: object }> = []) => ({
  text: 'Habari',
  user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
  timezone: 'Africa/Dar_es_Salaam',
  recentMessages: [],
  tools
});

describe('OpenRouterProvider', () => {
  it('points the OpenAI client at OpenRouter with attribution headers', () => {
    const provider = new OpenRouterProvider({
      apiKey: 'or-key',
      model: 'openai/gpt-4o-mini',
      siteUrl: 'https://example.com'
    });
    const client = (provider as any).client;

    expect(client.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(client.apiKey).toBe('or-key');
    expect(client.timeout).toBe(30_000);
    expect((provider as any).options.defaultHeaders).toEqual({
      'X-Title': 'Hawa WhatsApp Bot',
      'HTTP-Referer': 'https://example.com'
    });
  });

  it('sends fallback models for OpenRouter routing and keeps tool calling', async () => {
    const provider = new OpenRouterProvider({
      apiKey: 'or-key',
      model: 'openai/gpt-4o-mini',
      fallbackModels: ['openai/gpt-4o-mini', 'google/gemini-flash']
    });
    const create = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          tool_calls: [{ type: 'function', function: { name: 'TaskTool', arguments: '{"action":"list"}' } }]
        }
      }]
    });
    (provider as any).client = { chat: { completions: { create } } };

    const decision = await provider.decide(decideInput([{ name: 'TaskTool', description: 'Tasks', inputSchema: {} }]));

    expect(decision).toEqual({ kind: 'tool', toolName: 'TaskTool', toolInput: { action: 'list' } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-4o-mini',
      models: ['openai/gpt-4o-mini', 'google/gemini-flash'],
      tool_choice: 'auto'
    }));
  });

  it('omits tools when none are available', async () => {
    const provider = new OpenRouterProvider({ apiKey: 'or-key', model: 'openai/gpt-4o-mini' });
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Hi' } }] });
    (provider as any).client = { chat: { completions: { create } } };

    await provider.decide(decideInput());

    const request = create.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('tool_choice');
    expect(request).not.toHaveProperty('models');
  });

  it('transcribes voice notes through the JSON transcription endpoint', async () => {
    const provider = new OpenRouterProvider({ apiKey: 'or-key', model: 'openai/gpt-4o-mini' });
    const post = vi.fn().mockResolvedValue({ text: ' Nikumbushe kesho ' });
    (provider as any).client = { post };

    const transcript = await provider.transcribe(Buffer.from('audio'), 'audio/ogg');

    expect(transcript).toBe('Nikumbushe kesho');
    expect(post).toHaveBeenCalledWith('/audio/transcriptions', {
      body: {
        model: 'openai/whisper-1',
        input_audio: { data: Buffer.from('audio').toString('base64'), format: 'ogg' }
      }
    });
  });

  it('fails clearly when no API key is configured', async () => {
    const provider = new OpenRouterProvider({ model: 'openai/gpt-4o-mini' });

    await expect(provider.decide(decideInput())).rejects.toThrow('AI provider is not configured');
    await expect(provider.transcribe(Buffer.from('audio'), 'audio/ogg')).rejects.toThrow('AI provider is not configured');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../src/llm/OpenAIProvider.js';

describe('OpenAIProvider', () => {
  it('configures a short request timeout and one retry for chat responsiveness', () => {
    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      timeoutMs: 15_000
    } as any);

    expect((provider as any).client.timeout).toBe(15_000);
    expect((provider as any).client.maxRetries).toBe(1);
  });

  it('preserves tool messages from recent conversation history', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o-mini' });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Done' } }]
    });

    (provider as any).client = {
      chat: {
        completions: { create }
      }
    };

    await provider.decide({
      text: 'Continue',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [{ role: 'tool', content: 'Task created', toolCallId: 'call_123' }],
      tools: []
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'tool', content: 'Task created', tool_call_id: 'call_123' })
      ])
    }));
  });

  it('transcribes voice notes with the configured transcription model', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o-mini', transcriptionModel: 'whisper-1' });
    const create = vi.fn().mockResolvedValue({ text: '  Habari, nikumbushe kesho  ' });
    (provider as any).client = { audio: { transcriptions: { create } } };

    const transcript = await provider.transcribe(Buffer.from('audio'), 'audio/ogg');

    expect(transcript).toBe('Habari, nikumbushe kesho');
    const request = create.mock.calls[0]?.[0];
    expect(request.model).toBe('whisper-1');
    expect(request.file.name).toBe('voice-note.ogg');
  });
});

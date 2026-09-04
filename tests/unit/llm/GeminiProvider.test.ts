import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../../src/llm/GeminiProvider.js';

describe('GeminiProvider', () => {
  it('returns final text responses', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-3.7-flash' });
    const fetchMock = vi.fn().mockResolvedValue(response({
      candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }]
    }));
    vi.stubGlobal('fetch', fetchMock);

    const decision = await provider.decide({
      text: 'hello',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [],
      tools: []
    });

    expect(decision).toEqual({ kind: 'final', content: 'Hello from Gemini' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' })
      })
    );

    vi.unstubAllGlobals();
  });

  it('returns function calls as tool decisions', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-3.7-flash' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: 'ReminderTool',
              args: { action: 'create', title: 'Submit assignment' }
            }
          }]
        }
      }]
    })));

    const decision = await provider.decide({
      text: 'remind me',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [],
      tools: [{
        name: 'ReminderTool',
        description: 'Create reminders',
        inputSchema: { type: 'object', properties: { action: { enum: ['create'] } } }
      }]
    });

    expect(decision).toEqual({
      kind: 'tool',
      toolName: 'ReminderTool',
      toolInput: { action: 'create', title: 'Submit assignment' }
    });

    vi.unstubAllGlobals();
  });

  it('passes an abort signal to Gemini requests when a timeout is configured', async () => {
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.7-flash',
      timeoutMs: 500
    } as any);
    const fetchMock = vi.fn().mockResolvedValue(response({
      candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }]
    }));
    vi.stubGlobal('fetch', fetchMock);

    await provider.decide({
      text: 'hello',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [],
      tools: []
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );

    vi.unstubAllGlobals();
  });

  it('reports Gemini timeouts clearly', async () => {
    vi.useFakeTimers();
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.7-flash',
      timeoutMs: 25
    } as any);
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));

    const decision = provider.decide({
      text: 'hello',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [],
      tools: []
    });
    const expectedTimeout = expect(decision).rejects.toThrow('Gemini request timed out after 25ms');
    await vi.advanceTimersByTimeAsync(25);

    await expectedTimeout;

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('falls back to another model when the primary Gemini model times out', async () => {
    vi.useFakeTimers();
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.7-flash',
      fallbackModels: ['gemini-3.5-flash-lite'],
      timeoutMs: 25
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }))
      .mockResolvedValueOnce(response({
        candidates: [{ content: { parts: [{ text: 'Fallback response' }] } }]
      }));
    vi.stubGlobal('fetch', fetchMock);

    const decision = provider.decide({
      text: 'hello',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [],
      tools: []
    });
    const expectedFallback = expect(decision).resolves.toEqual({ kind: 'final', content: 'Fallback response' });
    await vi.advanceTimersByTimeAsync(25);

    await expectedFallback;
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      expect.any(Object)
    );

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('falls back to another model when the primary Gemini model is overloaded', async () => {
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.7-flash',
      fallbackModels: ['gemini-2.5-flash']
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: {
            message: 'This model is currently experiencing high demand.'
          }
        })
      })
      .mockResolvedValueOnce(response({
        candidates: [{ content: { parts: [{ text: 'Fallback response' }] } }]
      }));
    vi.stubGlobal('fetch', fetchMock);

    const decision = await provider.decide({
      text: 'hello',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [],
      tools: []
    });

    expect(decision).toEqual({ kind: 'final', content: 'Fallback response' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.any(Object)
    );

    vi.unstubAllGlobals();
  });

  it('falls back when the primary Gemini model is unavailable for the account', async () => {
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      fallbackModels: ['gemini-3.6-flash']
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          error: {
            message: 'This model models/gemini-2.5-flash is no longer available to new users.'
          }
        })
      })
      .mockResolvedValueOnce(response({
        candidates: [{ content: { parts: [{ text: 'Available model response' }] } }]
      }));
    vi.stubGlobal('fetch', fetchMock);

    const decision = await provider.decide({
      text: 'hello',
      user: { id: 'user-1', whatsappNumber: '255712345678', timezone: 'Africa/Dar_es_Salaam' },
      timezone: 'Africa/Dar_es_Salaam',
      recentMessages: [],
      tools: []
    });

    expect(decision).toEqual({ kind: 'final', content: 'Available model response' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      expect.any(Object)
    );

    vi.unstubAllGlobals();
  });
});

function response(body: unknown) {
  return {
    ok: true,
    json: async () => body
  };
}

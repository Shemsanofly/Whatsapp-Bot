import { OpenAIProvider } from './OpenAIProvider.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// OpenRouter's transcription endpoint takes a format name rather than a MIME type.
const AUDIO_FORMATS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac'
};

/**
 * OpenRouter exposes an OpenAI-compatible chat API, so chat and tool calling reuse
 * OpenAIProvider. Transcription differs: it takes base64 JSON instead of a file upload.
 */
export class OpenRouterProvider extends OpenAIProvider {
  constructor(options: {
    apiKey?: string;
    model: string;
    fallbackModels?: string[];
    transcriptionModel?: string;
    appName?: string;
    siteUrl?: string;
    timeoutMs?: number;
    baseURL?: string;
  }) {
    const fallbackModels = (options.fallbackModels ?? []).filter((model) => model !== options.model);
    super({
      apiKey: options.apiKey,
      model: options.model,
      transcriptionModel: options.transcriptionModel ?? 'openai/whisper-1',
      timeoutMs: options.timeoutMs ?? 30_000,
      baseURL: options.baseURL ?? OPENROUTER_BASE_URL,
      defaultHeaders: {
        'X-Title': options.appName ?? 'Hawa WhatsApp Bot',
        ...(options.siteUrl ? { 'HTTP-Referer': options.siteUrl } : {})
      },
      // OpenRouter tries these models in order when the primary one is unavailable.
      extraBody: fallbackModels.length > 0 ? { models: [options.model, ...fallbackModels] } : undefined
    });
  }

  override async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    if (!this.options.apiKey) {
      throw new Error('AI provider is not configured');
    }
    const response = await this.client.post<unknown, { text?: string }>('/audio/transcriptions', {
      body: {
        model: this.options.transcriptionModel,
        input_audio: {
          data: audio.toString('base64'),
          format: AUDIO_FORMATS[mimeType] ?? 'ogg'
        }
      }
    });
    return (response.text ?? '').trim();
  }
}

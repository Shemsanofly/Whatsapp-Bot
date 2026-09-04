import { z } from 'zod';
import type { LLMProvider } from '../../agent/types.js';
import type { AgentTool, ToolExecutionContext, ToolResult } from '../AgentTool.js';

const summarizationInputSchema = z.object({
  text: z.string().min(1),
  mode: z.enum(['summary', 'tldr', 'key_points', 'conversation']).optional()
});

export class SummarizationTool implements AgentTool {
  name = 'SummarizationTool';
  description = 'Summarize text, long pasted content, or recent conversation safely by chunking long inputs.';
  inputSchema = {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      mode: { enum: ['summary', 'tldr', 'key_points', 'conversation'] }
    }
  };

  constructor(
    private readonly llm: LLMProvider,
    private readonly maxChunkLength = 8000
  ) {}

  async execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    void context;
    const parsed = summarizationInputSchema.parse(input);
    const summarize = this.llm.summarize?.bind(this.llm);
    if (!summarize) {
      return { ok: false, message: 'Summarization is not available because the AI provider is not configured.' };
    }

    const chunks = chunkText(parsed.text, this.maxChunkLength);
    const partials = [];
    for (const chunk of chunks) {
      partials.push(await summarize(chunk, parsed.mode));
    }
    const final = partials.length === 1 ? partials[0] : await summarize(partials.join('\n'), parsed.mode);
    return { ok: true, message: final, data: { chunks: chunks.length } };
  }
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

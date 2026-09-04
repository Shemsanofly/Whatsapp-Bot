import { SummarizationTool } from '../../../src/tools/summarization/SummarizationTool.js';
import type { LLMProvider } from '../../../src/agent/types.js';

describe('SummarizationTool', () => {
  it('chunks long text before summarizing', async () => {
    const observedInputs: number[] = [];
    const llm: LLMProvider = {
      decide: async () => ({ kind: 'final', content: 'unused' }),
      summarize: async (input) => {
        observedInputs.push(input.length);
        return `summary:${input.length}`;
      }
    };
    const tool = new SummarizationTool(llm, 20);

    const result = await tool.execute({ text: 'a'.repeat(45), mode: 'key_points' }, { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' });

    expect(result.ok).toBe(true);
    expect(observedInputs).toEqual([20, 20, 5, 31]);
  });
});

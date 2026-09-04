import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../../src/llm/prompts.js';

describe('buildSystemPrompt', () => {
  it('instructs the agent to understand and reply naturally in Swahili or English', () => {
    const prompt = buildSystemPrompt('Africa/Dar_es_Salaam');

    expect(prompt).toMatch(/Swahili/i);
    expect(prompt).toMatch(/English/i);
    expect(prompt).toMatch(/same language/i);
  });

  it('instructs the agent to use memory for identity questions and outbound tools for messaging by name', () => {
    const prompt = buildSystemPrompt('Africa/Dar_es_Salaam');

    expect(prompt).toMatch(/who am I/i);
    expect(prompt).toMatch(/MemoryTool/i);
    expect(prompt).toMatch(/saved memories/i);
    expect(prompt).toMatch(/contact name/i);
    expect(prompt).toMatch(/voice calls are not implemented/i);
  });
});

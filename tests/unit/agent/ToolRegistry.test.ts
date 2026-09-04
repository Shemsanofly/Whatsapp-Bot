import { ToolRegistry } from '../../../src/agent/ToolRegistry.js';
import type { AgentTool } from '../../../src/tools/AgentTool.js';

const tool: AgentTool = {
  name: 'TaskTool',
  description: 'Manages tasks',
  inputSchema: { type: 'object' },
  execute: async () => ({ ok: true, message: 'done' })
};

describe('ToolRegistry', () => {
  it('registers tools and returns tool definitions for LLM tool calling', () => {
    const registry = new ToolRegistry([tool]);

    expect(registry.get('TaskTool')).toBe(tool);
    expect(registry.listForLLM()).toEqual([
      {
        name: 'TaskTool',
        description: 'Manages tasks',
        inputSchema: { type: 'object' }
      }
    ]);
    expect(registry.listCapabilities()).toEqual([
      {
        name: 'TaskTool',
        description: 'Manages tasks',
        inputSchema: { type: 'object' },
        enabled: true
      }
    ]);
  });
});

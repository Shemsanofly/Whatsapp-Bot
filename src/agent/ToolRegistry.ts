import type { ToolDefinition } from './types.js';
import type { AgentTool } from '../tools/AgentTool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[] = []) {
    tools.forEach((tool) => this.register(tool));
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  listForLLM(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  listCapabilities(): Array<ToolDefinition & { enabled: boolean }> {
    return this.listForLLM().map((tool) => ({
      ...tool,
      enabled: true
    }));
  }
}

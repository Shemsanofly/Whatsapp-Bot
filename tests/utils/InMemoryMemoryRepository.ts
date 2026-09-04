import type { Memory, MemoryRepository } from '../../src/tools/memory/types.js';

export class InMemoryMemoryRepository implements MemoryRepository {
  private memories: Memory[] = [];

  async create(userId: string, content: string): Promise<Memory> {
    const memory = {
      id: `memory-${this.memories.length + 1}`,
      userId,
      content,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.memories.push(memory);
    return memory;
  }

  async search(userId: string, query: string): Promise<Memory[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.memories.filter((memory) =>
      memory.userId === userId &&
      terms.some((term) => memory.content.toLowerCase().includes(term))
    );
  }
}

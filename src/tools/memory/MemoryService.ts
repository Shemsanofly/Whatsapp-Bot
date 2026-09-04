import type { Memory, MemoryRepository } from './types.js';

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  remember(userId: string, content: string): Promise<Memory> {
    return this.repository.create(userId, content);
  }

  search(userId: string, query: string): Promise<Memory[]> {
    return this.repository.search(userId, query);
  }
}

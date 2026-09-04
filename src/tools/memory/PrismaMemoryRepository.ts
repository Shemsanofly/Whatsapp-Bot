import type { PrismaClient } from '@prisma/client';
import type { Memory, MemoryRepository } from './types.js';

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, content: string): Promise<Memory> {
    return this.prisma.memory.create({ data: { userId, content } });
  }

  async search(userId: string, query: string): Promise<Memory[]> {
    const terms = query.split(/\s+/).filter((term) => term.length > 2);
    if (terms.length === 0) {
      return [];
    }
    return this.prisma.memory.findMany({
      where: {
        userId,
        OR: terms.map((term) => ({ content: { contains: term } }))
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
  }
}

import type { PrismaClient } from '@prisma/client';
import type { Task, TaskRepository } from './types.js';

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: Parameters<TaskRepository['create']>[0]): Promise<Task> {
    return this.prisma.task.create({ data });
  }

  async list(userId: string): Promise<Task[]> {
    return this.prisma.task.findMany({ where: { userId } });
  }

  async update(id: string, data: Partial<Task>): Promise<Task> {
    return this.prisma.task.update({ where: { id }, data });
  }

  async findByTitle(userId: string, query: string): Promise<Task | null> {
    return this.prisma.task.findFirst({
      where: {
        userId,
        title: { contains: query }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }
}

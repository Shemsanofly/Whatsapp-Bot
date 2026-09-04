import type { Task, TaskPriority, TaskRepository } from './types.js';

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  async create(input: {
    userId: string;
    title: string;
    description?: string | null;
    priority?: TaskPriority;
    dueDate?: Date | null;
  }): Promise<Task> {
    return this.repository.create({
      userId: input.userId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ?? null
    });
  }

  async list(userId: string, filter?: { from?: Date; to?: Date }): Promise<Task[]> {
    const tasks = await this.repository.list(userId);
    return tasks
      .filter((task) => task.status !== 'cancelled')
      .filter((task) => {
        if (!filter?.from && !filter?.to) {
          return true;
        }
        if (!task.dueDate) {
          return false;
        }
        return (!filter.from || task.dueDate >= filter.from) && (!filter.to || task.dueDate <= filter.to);
      })
      .sort((left, right) => {
        const leftTime = left.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });
  }

  async complete(userId: string, query: string): Promise<Task | null> {
    const task = await this.repository.findByTitle(userId, query);
    if (!task || task.status === 'completed') {
      return null;
    }
    return this.repository.update(task.id, {
      status: 'completed',
      completedAt: new Date()
    });
  }

  async reschedule(userId: string, query: string, dueDate: Date): Promise<Task | null> {
    const task = await this.repository.findByTitle(userId, query);
    if (!task || task.status === 'completed' || task.status === 'cancelled') {
      return null;
    }
    return this.repository.update(task.id, { dueDate });
  }
}

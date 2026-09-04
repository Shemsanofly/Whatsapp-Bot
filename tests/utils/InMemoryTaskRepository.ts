import type { Task, TaskRepository, TaskStatus } from '../../src/tools/tasks/types.js';

export class InMemoryTaskRepository implements TaskRepository {
  private tasks: Task[] = [];

  async create(data: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'status'> & { status?: TaskStatus }): Promise<Task> {
    const now = new Date();
    const task: Task = {
      id: `task-${this.tasks.length + 1}`,
      status: data.status ?? 'open',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      ...data
    };
    this.tasks.push(task);
    return task;
  }

  async list(userId: string): Promise<Task[]> {
    return this.tasks.filter((task) => task.userId === userId);
  }

  async update(id: string, data: Partial<Task>): Promise<Task> {
    const index = this.tasks.findIndex((task) => task.id === id);
    this.tasks[index] = { ...this.tasks[index], ...data, updatedAt: new Date() };
    return this.tasks[index];
  }

  async findByTitle(userId: string, query: string): Promise<Task | null> {
    return this.tasks.find((task) => task.userId === userId && task.title.toLowerCase().includes(query.toLowerCase())) ?? null;
  }
}

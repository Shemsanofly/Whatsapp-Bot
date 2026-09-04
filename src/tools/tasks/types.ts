export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

export interface TaskRepository {
  create(data: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'status'> & { status?: TaskStatus }): Promise<Task>;
  list(userId: string): Promise<Task[]>;
  update(id: string, data: Partial<Task>): Promise<Task>;
  findByTitle(userId: string, query: string): Promise<Task | null>;
}

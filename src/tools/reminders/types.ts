export type ReminderStatus = 'scheduled' | 'completed' | 'cancelled';

export interface Reminder {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  remindAt: Date;
  timezone: string;
  recurrenceRule?: string | null;
  status: ReminderStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  lastTriggeredAt?: Date | null;
}

export interface ReminderRepository {
  create(data: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'cancelledAt' | 'lastTriggeredAt' | 'status'>): Promise<Reminder>;
  list(userId: string): Promise<Reminder[]>;
  findByTitle(userId: string, query: string): Promise<Reminder | null>;
  findDue(now: Date): Promise<Reminder[]>;
  update(id: string, data: Partial<Reminder>): Promise<Reminder>;
}

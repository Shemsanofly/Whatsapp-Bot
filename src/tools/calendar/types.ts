export interface CalendarEvent {
  id: string;
  userId: string;
  provider: 'local' | 'google';
  providerEventId?: string | null;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  timezone: string;
  location?: string | null;
  participants: string[];
  status: 'confirmed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarProvider {
  createEvent(input: Omit<CalendarEvent, 'id' | 'provider' | 'providerEventId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<CalendarEvent>;
  listEvents(userId: string, from: Date, to: Date): Promise<CalendarEvent[]>;
  findEvent(userId: string, query: string): Promise<CalendarEvent | null>;
  updateEvent(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent>;
  cancelEvent(id: string): Promise<CalendarEvent>;
}

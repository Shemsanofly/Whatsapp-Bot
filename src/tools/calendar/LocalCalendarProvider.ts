import type { CalendarEvent, CalendarProvider } from './types.js';

export class LocalCalendarProvider implements CalendarProvider {
  private readonly events: CalendarEvent[] = [];

  async createEvent(input: Omit<CalendarEvent, 'id' | 'provider' | 'providerEventId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<CalendarEvent> {
    const now = new Date();
    const event: CalendarEvent = {
      id: `event-${this.events.length + 1}`,
      provider: 'local',
      providerEventId: null,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
      ...input
    };
    this.events.push(event);
    return event;
  }

  async listEvents(userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    return this.events
      .filter((event) => event.userId === userId && event.status === 'confirmed')
      .filter((event) => event.startTime >= from && event.startTime <= to)
      .sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
  }

  async findEvent(userId: string, query: string): Promise<CalendarEvent | null> {
    return this.events.find((event) =>
      event.userId === userId &&
      event.status === 'confirmed' &&
      event.title.toLowerCase().includes(query.toLowerCase())
    ) ?? null;
  }

  async updateEvent(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const index = this.events.findIndex((event) => event.id === id);
    this.events[index] = { ...this.events[index], ...input, updatedAt: new Date() };
    return this.events[index];
  }

  async cancelEvent(id: string): Promise<CalendarEvent> {
    return this.updateEvent(id, { status: 'cancelled' });
  }
}

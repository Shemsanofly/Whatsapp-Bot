import type { CalendarEvent, CalendarProvider } from './types.js';

export class CalendarService {
  constructor(private readonly provider: CalendarProvider) {}

  async create(input: {
    userId: string;
    title: string;
    description?: string | null;
    startTime: Date;
    endTime: Date;
    timezone: string;
    location?: string | null;
    participants?: string[];
  }): Promise<CalendarEvent> {
    return this.provider.createEvent({
      userId: input.userId,
      title: input.title,
      description: input.description ?? null,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone,
      location: input.location ?? null,
      participants: input.participants ?? []
    });
  }

  list(userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    return this.provider.listEvents(userId, from, to);
  }

  async move(userId: string, query: string, startTime: Date, endTime: Date): Promise<CalendarEvent | null> {
    const event = await this.provider.findEvent(userId, query);
    if (!event) {
      return null;
    }
    return this.provider.updateEvent(event.id, { startTime, endTime });
  }

  async cancel(userId: string, query: string): Promise<CalendarEvent | null> {
    const event = await this.provider.findEvent(userId, query);
    if (!event) {
      return null;
    }
    return this.provider.cancelEvent(event.id);
  }
}

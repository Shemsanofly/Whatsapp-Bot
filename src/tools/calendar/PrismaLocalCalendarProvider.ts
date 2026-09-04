import type { PrismaClient } from '@prisma/client';
import type { CalendarEvent, CalendarProvider } from './types.js';

export class PrismaLocalCalendarProvider implements CalendarProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async createEvent(input: Omit<CalendarEvent, 'id' | 'provider' | 'providerEventId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<CalendarEvent> {
    const event = await this.prisma.calendarEvent.create({
      data: {
        userId: input.userId,
        provider: 'local',
        title: input.title,
        description: input.description ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        timezone: input.timezone,
        location: input.location ?? null,
        participantsJson: JSON.stringify(input.participants)
      }
    });
    return toCalendarEvent(event);
  }

  async listEvents(userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        userId,
        status: 'confirmed',
        startTime: { gte: from, lte: to }
      },
      orderBy: { startTime: 'asc' }
    });
    return events.map(toCalendarEvent);
  }

  async findEvent(userId: string, query: string): Promise<CalendarEvent | null> {
    const event = await this.prisma.calendarEvent.findFirst({
      where: {
        userId,
        status: 'confirmed',
        title: { contains: query }
      },
      orderBy: { startTime: 'asc' }
    });
    return event ? toCalendarEvent(event) : null;
  }

  async updateEvent(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const event = await this.prisma.calendarEvent.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        timezone: input.timezone,
        location: input.location,
        participantsJson: input.participants ? JSON.stringify(input.participants) : undefined,
        status: input.status
      }
    });
    return toCalendarEvent(event);
  }

  async cancelEvent(id: string): Promise<CalendarEvent> {
    return this.updateEvent(id, { status: 'cancelled' });
  }
}

function toCalendarEvent(event: {
  id: string;
  userId: string;
  provider: 'local' | 'google';
  providerEventId: string | null;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  timezone: string;
  location: string | null;
  participantsJson: string | null;
  status: 'confirmed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}): CalendarEvent {
  return {
    id: event.id,
    userId: event.userId,
    provider: event.provider,
    providerEventId: event.providerEventId,
    title: event.title,
    description: event.description,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone,
    location: event.location,
    participants: event.participantsJson ? JSON.parse(event.participantsJson) as string[] : [],
    status: event.status,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

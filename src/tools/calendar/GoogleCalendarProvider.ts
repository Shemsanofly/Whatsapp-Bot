import { google, calendar_v3 } from 'googleapis';
import type { CalendarEvent, CalendarProvider } from './types.js';

export class GoogleCalendarProvider implements CalendarProvider {
  private readonly calendar: calendar_v3.Calendar;

  constructor(private readonly options: {
    credentialsJson: string;
    calendarId: string;
  }) {
    const credentials = JSON.parse(options.credentialsJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async createEvent(input: Omit<CalendarEvent, 'id' | 'provider' | 'providerEventId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<CalendarEvent> {
    const created = await this.calendar.events.insert({
      calendarId: this.options.calendarId,
      requestBody: {
        summary: input.title,
        description: input.description ?? undefined,
        location: input.location ?? undefined,
        start: { dateTime: input.startTime.toISOString(), timeZone: input.timezone },
        end: { dateTime: input.endTime.toISOString(), timeZone: input.timezone },
        attendees: input.participants.map((email) => ({ email }))
      }
    });
    if (!created.data.id) {
      throw new Error('Google Calendar did not return an event id');
    }
    return {
      id: created.data.id,
      userId: input.userId,
      provider: 'google',
      providerEventId: created.data.id,
      title: input.title,
      description: input.description ?? null,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone,
      location: input.location ?? null,
      participants: input.participants,
      status: 'confirmed',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async listEvents(userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const response = await this.calendar.events.list({
      calendarId: this.options.calendarId,
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    return (response.data.items ?? []).map((event) => ({
      id: event.id ?? '',
      userId,
      provider: 'google',
      providerEventId: event.id ?? null,
      title: event.summary ?? 'Untitled event',
      description: event.description ?? null,
      startTime: new Date(event.start?.dateTime ?? event.start?.date ?? from.toISOString()),
      endTime: new Date(event.end?.dateTime ?? event.end?.date ?? to.toISOString()),
      timezone: event.start?.timeZone ?? 'UTC',
      location: event.location ?? null,
      participants: (event.attendees ?? []).map((attendee) => attendee.email ?? '').filter(Boolean),
      status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
      createdAt: new Date(event.created ?? Date.now()),
      updatedAt: new Date(event.updated ?? Date.now())
    }));
  }

  async findEvent(userId: string, query: string): Promise<CalendarEvent | null> {
    const now = new Date();
    const events = await this.listEvents(userId, now, new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30));
    return events.find((event) => event.title.toLowerCase().includes(query.toLowerCase())) ?? null;
  }

  async updateEvent(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const updated = await this.calendar.events.patch({
      calendarId: this.options.calendarId,
      eventId: id,
      requestBody: {
        summary: input.title,
        description: input.description ?? undefined,
        location: input.location ?? undefined,
        start: input.startTime ? { dateTime: input.startTime.toISOString(), timeZone: input.timezone } : undefined,
        end: input.endTime ? { dateTime: input.endTime.toISOString(), timeZone: input.timezone } : undefined
      }
    });
    return {
      id,
      userId: input.userId ?? '',
      provider: 'google',
      providerEventId: id,
      title: updated.data.summary ?? input.title ?? 'Untitled event',
      description: updated.data.description ?? input.description ?? null,
      startTime: new Date(updated.data.start?.dateTime ?? input.startTime ?? Date.now()),
      endTime: new Date(updated.data.end?.dateTime ?? input.endTime ?? Date.now()),
      timezone: updated.data.start?.timeZone ?? input.timezone ?? 'UTC',
      location: updated.data.location ?? input.location ?? null,
      participants: (updated.data.attendees ?? []).map((attendee) => attendee.email ?? '').filter(Boolean),
      status: updated.data.status === 'cancelled' ? 'cancelled' : 'confirmed',
      createdAt: new Date(updated.data.created ?? Date.now()),
      updatedAt: new Date(updated.data.updated ?? Date.now())
    };
  }

  async cancelEvent(id: string): Promise<CalendarEvent> {
    await this.calendar.events.delete({
      calendarId: this.options.calendarId,
      eventId: id
    });
    return {
      id,
      userId: '',
      provider: 'google',
      providerEventId: id,
      title: 'Cancelled event',
      startTime: new Date(),
      endTime: new Date(),
      timezone: 'UTC',
      participants: [],
      status: 'cancelled',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

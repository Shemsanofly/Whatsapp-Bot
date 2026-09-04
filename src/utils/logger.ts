import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['AI_API_KEY', 'DATABASE_URL', '*.credentials', '*.apiKey']
});

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  AI_PROVIDER: z.string().default('openai'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),
  GEMINI_FALLBACK_MODELS: z.string().default('gemini-3.5-flash-lite,gemini-3.5-flash'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
  WHATSAPP_AUTH_DIR: z.string().default('.whatsapp-auth'),
  AGENT_WHATSAPP_NUMBER: z.string().default(''),
  ALLOWED_WHATSAPP_NUMBERS: z.string().default(''),
  WHATSAPP_REPLY_TO_ALL: z.coerce.boolean().default(true),
  WHATSAPP_PROCESS_FROM_ME_COMMANDS: z.coerce.boolean().default(false),
  WHATSAPP_FROM_ME_COMMAND_PREFIX: z.string().default('/agent'),
  TIMEZONE: z.string().default('Africa/Dar_es_Salaam'),
  GOOGLE_CALENDAR_CREDENTIALS: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().default('primary')
});

const parsed = envSchema.parse(process.env);
process.env.DATABASE_URL = parsed.DATABASE_URL;

export const env = {
  ...parsed,
  geminiFallbackModels: parsed.GEMINI_FALLBACK_MODELS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  allowedWhatsAppNumbers: parsed.ALLOWED_WHATSAPP_NUMBERS.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
};

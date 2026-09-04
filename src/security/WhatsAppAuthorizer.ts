export class WhatsAppAuthorizer {
  private readonly allowedNumbers: Set<string>;

  constructor(allowedNumbers: string[]) {
    this.allowedNumbers = new Set(allowedNumbers.map(normalizeWhatsAppNumber).filter(Boolean));
  }

  isAuthorized(sender: string | Array<string | undefined>): boolean {
    const candidates = Array.isArray(sender) ? sender : [sender];
    return candidates.some((candidate) => {
      const normalized = normalizeWhatsAppNumber(candidate ?? '');
      return normalized.length > 0 && this.allowedNumbers.has(normalized);
    });
  }
}

export function normalizeWhatsAppNumber(value: string): string {
  return value
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@c\.us$/i, '')
    .replace(/@lid$/i, '')
    .replace(/:\d+$/i, '')
    .replace(/\D/g, '');
}

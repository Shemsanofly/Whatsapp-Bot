import { WhatsAppAuthorizer } from '../../../src/security/WhatsAppAuthorizer.js';

describe('WhatsAppAuthorizer', () => {
  it('authorizes allowed WhatsApp JIDs after normalizing phone numbers', () => {
    const authorizer = new WhatsAppAuthorizer(['+255 712 345 678']);

    expect(authorizer.isAuthorized('255712345678@s.whatsapp.net')).toBe(true);
    expect(authorizer.isAuthorized('255712345678:12@s.whatsapp.net')).toBe(true);
  });

  it('rejects non-allowlisted numbers', () => {
    const authorizer = new WhatsAppAuthorizer(['255712345678']);

    expect(authorizer.isAuthorized('255700000000@s.whatsapp.net')).toBe(false);
  });

  it('authorizes WhatsApp lid identifiers and alternate candidates', () => {
    const authorizer = new WhatsAppAuthorizer(['240539744137431']);

    expect(authorizer.isAuthorized('240539744137431@lid')).toBe(true);
    expect(authorizer.isAuthorized(['123@lid', '240539744137431@lid'])).toBe(true);
  });
});

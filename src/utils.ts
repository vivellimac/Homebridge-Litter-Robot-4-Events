export function parseJwt(token: string): Record<string, unknown> {
  try {
    const b64 = (token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

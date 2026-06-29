const SECRET_KEY = /token|secret|password|api[_-]?key|authorization|bearer/i;

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 8 && /^(sk-|ghp_|Bearer\s)/i.test(value)) return '[REDACTED]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === 'object') return redactObject(value as Record<string, unknown>);
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redactValue(val);
    }
  }
  return out;
}

/** Redact likely secrets from audit event payloads before persistence. */
export function redactAuditEvent(event: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...event };
  if ('arguments' in out && typeof out.arguments === 'object' && out.arguments !== null) {
    out.arguments = redactObject(out.arguments as Record<string, unknown>);
  }
  if (typeof out.error === 'string' && SECRET_KEY.test(out.error)) {
    out.error = '[REDACTED]';
  }
  if (typeof out.reason === 'string' && /Bearer\s+\S+/i.test(out.reason)) {
    out.reason = out.reason.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  }
  return out;
}

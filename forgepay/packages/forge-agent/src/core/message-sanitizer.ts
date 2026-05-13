export function sanitizeString(input: string): string {
  return input
    // Remove lone surrogates
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    // Remove null bytes
    .replace(/\x00/g, '')
    // Remove other control chars except tab, newline, carriage return
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function sanitizeMessages(
  messages: Array<{ role: string; content: string | unknown[] }>
): Array<{ role: string; content: string | unknown[] }> {
  return messages.map(m => ({
    ...m,
    content: typeof m.content === "string"
      ? sanitizeString(m.content)
      : m.content,
  }));
}

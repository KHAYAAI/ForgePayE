/**
 * Minimal RFC-4180 style CSV serializer.
 *
 * Rules:
 *   - Values containing comma, double-quote, CR or LF are wrapped in double-quotes
 *   - Internal double-quotes are escaped by doubling them ("" )
 *   - Booleans → 'true' / 'false'; null/undefined → empty string
 *   - Numbers are stringified without locale formatting
 */

export type CsvCell = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvCell>;

export function escapeCsvValue(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  const needsQuoting = /[",\r\n]/.test(str);
  if (!needsQuoting) return str;
  return '"' + str.replace(/"/g, '""') + '"';
}

export function toCsv(rows: CsvRow[], headers?: string[]): string {
  if (rows.length === 0 && (!headers || headers.length === 0)) return '';
  const cols = headers ?? Object.keys(rows[0] ?? {});
  const lines: string[] = [];
  lines.push(cols.map((c) => escapeCsvValue(c)).join(','));
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCsvValue(row[c])).join(','));
  }
  return lines.join('\r\n');
}

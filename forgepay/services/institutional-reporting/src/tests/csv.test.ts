import { describe, it, expect } from 'vitest';
import { escapeCsvValue, toCsv } from '../csv';

describe('escapeCsvValue', () => {
  it('passes through plain strings', () => {
    expect(escapeCsvValue('hello')).toBe('hello');
  });

  it('wraps strings containing comma in double-quotes', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
  });

  it('escapes embedded double-quotes by doubling', () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps strings with newline', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });

  it('converts numbers to string without locale formatting', () => {
    expect(escapeCsvValue(1234567.89)).toBe('1234567.89');
  });

  it('converts booleans', () => {
    expect(escapeCsvValue(true)).toBe('true');
    expect(escapeCsvValue(false)).toBe('false');
  });

  it('returns empty string for null and undefined', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('returns empty string for empty rows and no headers', () => {
    expect(toCsv([])).toBe('');
  });

  it('outputs header + data rows with CRLF line endings', () => {
    const rows = [
      { name: 'Alice', amount: 100 },
      { name: 'Bob',   amount: 200 },
    ];
    const result = toCsv(rows);
    const lines = result.split('\r\n');
    expect(lines[0]).toBe('name,amount');
    expect(lines[1]).toBe('Alice,100');
    expect(lines[2]).toBe('Bob,200');
  });

  it('respects explicit column order via headers param', () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    const result = toCsv(rows, ['c', 'a', 'b']);
    const lines = result.split('\r\n');
    expect(lines[0]).toBe('c,a,b');
    expect(lines[1]).toBe('3,1,2');
  });

  it('handles cells requiring quoting', () => {
    const rows = [{ note: 'has,comma', value: 42 }];
    const result = toCsv(rows);
    expect(result).toContain('"has,comma"');
  });

  it('outputs only header when headers provided and rows empty', () => {
    const result = toCsv([], ['col1', 'col2']);
    expect(result).toBe('col1,col2');
  });
});

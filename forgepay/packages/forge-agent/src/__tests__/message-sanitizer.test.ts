import { describe, it, expect } from "vitest";
import { sanitizeString, sanitizeMessages } from "../core/message-sanitizer";

describe("sanitizeString", () => {
  it("passes through clean strings unchanged", () => {
    expect(sanitizeString("Hello, world!")).toBe("Hello, world!");
  });

  it("removes null bytes", () => {
    expect(sanitizeString("foo\x00bar")).toBe("foobar");
  });

  it("removes lone high surrogates", () => {
    const withSurrogate = "test\uD800value";
    const result = sanitizeString(withSurrogate);
    expect(result).not.toContain("\uD800");
    expect(result).toContain("testvalue");
  });

  it("preserves tabs, newlines, carriage returns", () => {
    expect(sanitizeString("line1\nline2\ttabbed\r\n")).toBe("line1\nline2\ttabbed\r\n");
  });

  it("removes other control characters", () => {
    expect(sanitizeString("foo\x01\x1Fbar")).toBe("foobar");
  });
});

describe("sanitizeMessages", () => {
  it("sanitizes string content", () => {
    const msgs = [{ role: "user", content: "hello\x00world" }];
    const result = sanitizeMessages(msgs);
    expect(result[0].content).toBe("helloworld");
  });

  it("passes through array content unchanged", () => {
    const content = [{ type: "text", text: "hello" }];
    const msgs = [{ role: "user", content }];
    const result = sanitizeMessages(msgs);
    expect(result[0].content).toBe(content);
  });
});

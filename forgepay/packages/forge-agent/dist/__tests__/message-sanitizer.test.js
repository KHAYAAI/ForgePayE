"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const message_sanitizer_1 = require("../core/message-sanitizer");
(0, vitest_1.describe)("sanitizeString", () => {
    (0, vitest_1.it)("passes through clean strings unchanged", () => {
        (0, vitest_1.expect)((0, message_sanitizer_1.sanitizeString)("Hello, world!")).toBe("Hello, world!");
    });
    (0, vitest_1.it)("removes null bytes", () => {
        (0, vitest_1.expect)((0, message_sanitizer_1.sanitizeString)("foo\x00bar")).toBe("foobar");
    });
    (0, vitest_1.it)("removes lone high surrogates", () => {
        const withSurrogate = "test\uD800value";
        const result = (0, message_sanitizer_1.sanitizeString)(withSurrogate);
        (0, vitest_1.expect)(result).not.toContain("\uD800");
        (0, vitest_1.expect)(result).toContain("testvalue");
    });
    (0, vitest_1.it)("preserves tabs, newlines, carriage returns", () => {
        (0, vitest_1.expect)((0, message_sanitizer_1.sanitizeString)("line1\nline2\ttabbed\r\n")).toBe("line1\nline2\ttabbed\r\n");
    });
    (0, vitest_1.it)("removes other control characters", () => {
        (0, vitest_1.expect)((0, message_sanitizer_1.sanitizeString)("foo\x01\x1Fbar")).toBe("foobar");
    });
});
(0, vitest_1.describe)("sanitizeMessages", () => {
    (0, vitest_1.it)("sanitizes string content", () => {
        const msgs = [{ role: "user", content: "hello\x00world" }];
        const result = (0, message_sanitizer_1.sanitizeMessages)(msgs);
        (0, vitest_1.expect)(result[0].content).toBe("helloworld");
    });
    (0, vitest_1.it)("passes through array content unchanged", () => {
        const content = [{ type: "text", text: "hello" }];
        const msgs = [{ role: "user", content }];
        const result = (0, message_sanitizer_1.sanitizeMessages)(msgs);
        (0, vitest_1.expect)(result[0].content).toBe(content);
    });
});
//# sourceMappingURL=message-sanitizer.test.js.map
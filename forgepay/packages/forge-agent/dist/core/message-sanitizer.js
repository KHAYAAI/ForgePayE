"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeString = sanitizeString;
exports.sanitizeMessages = sanitizeMessages;
function sanitizeString(input) {
    return input
        // Remove lone surrogates
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
        // Remove null bytes
        .replace(/\x00/g, '')
        // Remove other control chars except tab, newline, carriage return
        .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
function sanitizeMessages(messages) {
    return messages.map(m => ({
        ...m,
        content: typeof m.content === "string"
            ? sanitizeString(m.content)
            : m.content,
    }));
}
//# sourceMappingURL=message-sanitizer.js.map
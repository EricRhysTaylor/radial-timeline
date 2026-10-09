// Author queries in a Word export become real margin comments.
//
// Editorialist's author queries (`%%query: <question>%%`, or the legacy
// `%%ai: <question>%%`) are questions the author leaves inline for their next
// reviewer. When a Word export keeps them (Strip author queries off), the raw
// markers would land in the document as `%%query: …%%` text. A human editor
// works in Word's margin instead, so each query becomes a Word comment at the
// spot it was asked, signed with the book's author. The editor can then answer
// in the comment thread, and that reply travels back with the document.
//
// Pandoc writes Word comments from paired spans:
//   [question]{.comment-start id="1" author="…" date="…"}[]{.comment-end id="1"}
// The range between start and end is empty, so the comment marks a point
// rather than highlighting prose that is not part of the question.
//
// Runs on sanitized markdown just before Pandoc, and only for Word: Markdown
// exports keep the markers (that is the Editorialist review path) and PDF has
// no comment layer. Fenced code blocks are left alone.

import { MARKDOWN_FENCE_OPEN_PATTERN as FENCE_PATTERN, isClosingMarkdownFence } from './markdownFence';

const AUTHOR_QUERY_PATTERN = /%%\s*(?:query|ai)\s*:\s*([\s\S]*?)%%/gi;

export interface AuthorQueryCommentOptions {
    /** Shown as the comment's author in Word. Falls back to "Author". */
    author?: string;
    /** ISO timestamp for every comment; defaults to now. */
    date?: string;
}

function tokenFor(index: number): string {
    return `\u0000RTQUERY${index}\u0000`;
}

const TOKEN_ONLY_LINE = /^\s*(?:\u0000RTQUERY\d+\u0000\s*)+$/;
const TOKEN_PATTERN = /\u0000RTQUERY(\d+)\u0000/g;

// Inline Markdown inside the comment must read as plain text.
function escapeCommentText(question: string): string {
    return question.replace(/([\\`*_[\]<>$~^])/g, '\\$1');
}

function escapeAttribute(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isoNow(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function convertAuthorQueriesToWordComments(
    markdown: string,
    options: AuthorQueryCommentOptions = {}
): string {
    const questions: string[] = [];

    // 1. Outside fenced code, swap each marker for a token and keep its question.
    const lines = markdown.split('\n');
    const segments: { text: string; fenced: boolean }[] = [];
    let buffer: string[] = [];
    let fence: string | null = null;
    const flush = (fenced: boolean): void => {
        if (buffer.length) segments.push({ text: buffer.join('\n'), fenced });
        buffer = [];
    };
    for (const line of lines) {
        const match = line.match(FENCE_PATTERN);
        if (fence === null && match) {
            flush(false);
            fence = match[1];
            buffer.push(line);
            continue;
        }
        if (fence !== null && isClosingMarkdownFence(line, fence)) {
            buffer.push(line);
            flush(true);
            fence = null;
            continue;
        }
        buffer.push(line);
    }
    flush(fence !== null);

    const tokenized = segments
        .map(({ text, fenced }) => fenced
            ? text
            : text.replace(AUTHOR_QUERY_PATTERN, (_marker, body: string) => {
                const question = body.replace(/\s+/g, ' ').trim();
                if (!question) return '';
                questions.push(question);
                return tokenFor(questions.length - 1);
            }))
        .join('\n');
    if (questions.length === 0) return tokenized;

    // 2. A query on a line of its own belongs to the paragraph above it: move it
    //    to the end of the previous non-blank line, so Word does not get an empty
    //    paragraph that holds nothing but a comment.
    const out: string[] = [];
    for (const line of tokenized.split('\n')) {
        if (TOKEN_ONLY_LINE.test(line)) {
            let target = out.length - 1;
            while (target >= 0 && out[target].trim() === '') target -= 1;
            // Never glue a comment onto a code fence line.
            if (target >= 0 && !FENCE_PATTERN.test(out[target])) {
                out[target] = `${out[target].replace(/\s+$/, '')}${line.trim().replace(/\s+/g, '')}`;
                continue;
            }
        }
        out.push(line);
    }

    // 3. Tokens become Pandoc comment spans.
    const author = escapeAttribute((options.author ?? '').trim() || 'Author');
    const date = escapeAttribute(options.date ?? isoNow());
    return out.join('\n').replace(TOKEN_PATTERN, (_token, index: string) => {
        const id = Number(index) + 1;
        const text = escapeCommentText(questions[Number(index)]);
        return `[${text}]{.comment-start id="${id}" author="${author}" date="${date}"}[]{.comment-end id="${id}"}`;
    });
}

import type { InquiryScope } from '../state';

export type CorpusSelectionKeyInput = {
    className: string;
    filePath: string;
    scope?: InquiryScope;
    sceneId?: string;
    bookId?: string;
};

export type ParsedCorpusSelectionKey = {
    className: string;
    scope?: InquiryScope;
    sceneId?: string;
    bookId?: string;
    path?: string;
};

const TOKEN_SCENE_ID = 'sceneId';
const TOKEN_PATH = 'path';

export function buildCorpusSelectionKey(input: CorpusSelectionKeyInput): string {
    const className = (input.className || '').trim();
    const scopeKey = input.scope ?? 'global';
    const sceneId = normalizeText(input.sceneId);

    if (className === 'scene' && sceneId && input.bookId) {
        return `${className}::${scopeKey}::bookScene::${encodeURIComponent(input.bookId)}::${sceneId}`;
    }

    return `${className}::${scopeKey}::${TOKEN_PATH}::${normalizeText(input.filePath) ?? ''}`;
}
export function parseCorpusSelectionKey(rawKey: string): ParsedCorpusSelectionKey {
    const parts = rawKey.split('::');
    const className = (parts.shift() ?? '').trim();
    const scope = parseScope(parts.shift());
    const token = parts.shift();

    if (token === 'bookScene') {
        const bookId = decodeURIComponent(parts.shift() ?? ''); // SAFE: absent segment represents an invalid empty book key
        return { className, scope, bookId, sceneId: normalizeText(parts.join('::')) };
    }

    if (token === TOKEN_SCENE_ID) {
        const sceneId = normalizeText(parts.join('::'));
        return {
            className,
            scope,
            sceneId
        };
    }

    if (token === TOKEN_PATH) {
        const path = normalizeText(parts.join('::'));
        return {
            className,
            scope,
            path
        };
    }

    return {
        className,
        scope
    };
}

function parseScope(value?: string): InquiryScope | undefined {
    if (value === 'book' || value === 'saga') return value;
    return undefined;
}

function normalizeText(value: string | undefined): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

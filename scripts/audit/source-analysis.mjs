import ts from 'typescript';

/** Physical source spans, including nested closures; overload signatures have no body. */
export function measureFunctions(text, filename = 'source.ts') {
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
    const rows = [];
    function visit(node) {
        if (ts.isFunctionLike(node) && node.body) {
            const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
            const name = ts.isConstructorDeclaration(node) ? 'constructor'
                : node.name?.getText(source) ?? node.parent.name?.getText(source) ?? '(callback)';
            rows.push({ name, start, end, lines: end - start + 1 });
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return rows;
}

/** Conservative candidates, not proof of use. Covers interpolation on either side
 * of a class token, including `${prefix}-summary` and `ert-state-${state}`.
 * Pure interpolation, generic joins and prose templates are excluded to avoid matching everything.
 */
export function dynamicClassPatterns(text, filename = 'source.ts') {
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
    const patterns = new Set();
    function visit(node) {
        if (ts.isTemplateExpression(node)) {
            const literals = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
            // Tokenize also inside multi-class strings and SVG attribute markup.
            // Interpolations remain opaque: this only establishes a possible producer.
            for (const token of literals.join('@').match(/[\w@-]+/g) ?? []) {
                const fixed = token.replace(/@/g, '');
                if (token.includes('@') && /[a-zA-Z]/.test(fixed) && fixed.includes('-')) {
                    patterns.add(`^${token.replace(/@/g, '[\\w-]+')}$`);
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return [...patterns].map(pattern => new RegExp(pattern));
}

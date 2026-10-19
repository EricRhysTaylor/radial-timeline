import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? (entry.name === 'locales' ? [] : files(path))
            : path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
    });
}
describe('tooltip ownership across production UI', () => {
    it('routes tooltip and accessibility writes through the shared adapters', () => {
        const violations: string[] = [];
        for (const file of files('src')) {
            if (file === 'src/utils/domTooltip.ts' || file === 'src/utils/tooltip.ts') continue;
            const raw = readFileSync(file, 'utf8');
            const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
            const report = (node: ts.Node) => violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
            const visit = (node: ts.Node) => {
                if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                    const method = node.expression.name.text;
                    const attr = node.arguments[0];
                    if (method === 'setTooltip') report(node);
                    if (['setAttr', 'setAttribute'].includes(method) && attr && ts.isStringLiteral(attr)
                        && ['title', 'aria-label'].includes(attr.text)) report(node);
                }
                if (ts.isPropertyAssignment(node) && node.parent && ts.isObjectLiteralExpression(node.parent)
                    && node.parent.parent && ts.isPropertyAssignment(node.parent.parent)
                    && node.parent.parent.name.getText(source) === 'attr'
                    && ['title', 'aria-label'].includes(node.name.getText(source).replace(/^['"]|['"]$/g, ''))) report(node);
                if (ts.isImportSpecifier(node) && node.name.text === 'setTooltip' && node.parent.parent.parent
                    && ts.isImportDeclaration(node.parent.parent.parent)
                    && node.parent.parent.parent.moduleSpecifier.getText(source) === "'obsidian'") report(node);
                ts.forEachChild(node, visit);
            };
            visit(source);
            if (/<title[ >]/.test(raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))) violations.push(`${file}: SVG native title`);
        }
        expect(violations).toEqual([]);
    });
});

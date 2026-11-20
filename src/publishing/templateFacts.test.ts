import { describe, expect, it } from 'vitest';
import { readTemplateFacts, stripLatexComments, templateDefinesStructuralMacros, templateHasBody } from './templateFacts';
import { getBundledPandocLayoutContent } from '../utils/pandocBundledLayouts';

const builtIn = (id: string) => readTemplateFacts(getBundledPandocLayoutContent(id) || '');

// The opening of Pandoc's stock LaTeX template (`pandoc -D latex`): nearly
// every line sits inside a `$if(...)$` block.
const PANDOC_STOCK_EXCERPT = String.raw`\documentclass[
$if(fontsize)$
  $fontsize$,
$endif$
$if(papersize)$
  $papersize$paper,
$endif$
$for(classoption)$
  $classoption$$sep$,
$endfor$
]{$documentclass$}
\usepackage{xcolor}
$if(geometry)$
\usepackage[$for(geometry)$$geometry$$sep$,$endfor$]{geometry}
$endif$
\usepackage{amsmath,amssymb}
$if(linestretch)$
\usepackage{setspace}
$endif$
$if(mainfont)$
\setmainfont[$for(mainfontoptions)$$mainfontoptions$$sep$,$endfor$]{$mainfont$}
$endif$
$if(toc)$
\tableofcontents
$endif$
$if(title)$
\title{$title$$if(thanks)$\thanks{$thanks$}$endif$}
$endif$
\author{$for(author)$$author$$sep$ \and $endfor$}
\date{$date$}
$for(header-includes)$
$header-includes$
$endfor$
\begin{document}
$body$
\end{document}
`;

describe('reading a template', () => {
    it('tells the four built-in layouts apart where they differ', () => {
        const basic = builtIn('bundled-fiction-classic-manuscript');
        const standard = builtIn('bundled-fiction-contemporary-literary');
        const professional = builtIn('bundled-fiction-signature-literary');
        const signature = builtIn('bundled-fiction-modern-classic');

        expect(basic.documentClass).toEqual({ kind: 'named', name: 'book', options: ['11pt', 'oneside'] });
        expect(standard.documentClass).toEqual({ kind: 'named', name: 'book', options: ['11pt', 'twoside'] });
        expect(signature.documentClass).toEqual({ kind: 'named', name: 'book', options: ['11pt', 'twoside', 'openany'] });

        expect(basic.fonts.map(font => font.name)).toEqual(['Arial']);
        expect(standard.fonts.map(font => font.name)).toEqual(['Source Serif 4']);
        expect(professional.fonts.map(font => font.name)).toEqual(['Sorts Mill Goudy']);
        expect(signature.fonts.map(font => font.name)).toEqual(['lmroman10-regular.otf']);

        // Only Signature takes parts, chapters and scene breaks through the structural macros.
        expect([basic, standard, professional, signature].map(facts => facts.structuralMacros)).toEqual([false, false, false, true]);

        const summaries = [basic, standard, professional, signature].map(facts => JSON.stringify(facts));
        expect(new Set(summaries).size).toBe(4);

        // What they share is reported the same for each.
        for (const facts of [basic, standard, professional, signature]) {
            expect(facts.hasBody).toBe(true);
            expect(facts.bookDetails).toEqual(['title', 'author']);
            expect(facts.readsHeaderIncludes).toBe(true);
            expect(facts.packages.map(item => item.name)).toEqual(expect.arrayContaining(['fontspec', 'fancyhdr', 'geometry']));
        }
    });

    it('never reports a fact from a comment', () => {
        const facts = readTemplateFacts([
            '% \\documentclass{memoir}',
            '\\documentclass{article}',
            '% Handles character encoding; dialogue uses normal quotes',
            '% \\chapter is not used here; \\usepackage{fancyhdr} was removed',
            '\\usepackage{geometry} % \\usepackage{titlesec}',
            '% \\setmainfont{EB Garamond}',
            '% \\newcommand{\\rtPart}[4]{} \\newcommand{\\rtChapter}[2]{} \\newcommand{\\rtSceneSep}[1]{}',
            '% $subtitle$',
            'Price: 5\\% off $title$',
            '\\begin{document}',
            '$body$',
            '\\end{document}',
        ].join('\n'));
        expect(facts.documentClass).toEqual({ kind: 'named', name: 'article', options: [] });
        expect(facts.packages).toEqual([{ name: 'geometry', conditional: false }]);
        expect(facts.fonts).toEqual([]);
        expect(facts.structuralMacros).toBe(false);
        expect(facts.otherVariables).toEqual([]);
        // An escaped percent sign is text, not the start of a comment.
        expect(facts.bookDetails).toEqual(['title']);
    });

    it('does not take a commented-out $body$ for the placeholder', () => {
        expect(templateHasBody('\\begin{document}\n% $body$\n\\end{document}')).toBe(false);
        expect(readTemplateFacts('% $body$').hasBody).toBe(false);
        expect(templateHasBody('\\begin{document}\n$body$ % the manuscript\n\\end{document}')).toBe(true);
    });

    it('never reports a line inside a Pandoc $if$ block as on', () => {
        const facts = readTemplateFacts(PANDOC_STOCK_EXCERPT);
        // The class is whatever the variable holds; its options are all variables.
        expect(facts.documentClass).toEqual({ kind: 'variable', variable: 'documentclass' });
        expect(facts.packages).toEqual([
            { name: 'xcolor', conditional: false },
            { name: 'geometry', conditional: true },
            { name: 'amsmath', conditional: false },
            { name: 'amssymb', conditional: false },
            { name: 'setspace', conditional: true },
        ]);
        // A font set from a variable is not a font the template names.
        expect(facts.fonts).toEqual([]);
        expect(facts.bookDetails).toEqual(['title', 'author']);
        expect(facts.readsHeaderIncludes).toBe(true);
        expect(facts.otherVariables).toEqual(['classoption', 'date', 'documentclass', 'fontsize', 'geometry', 'linestretch', 'mainfont', 'mainfontoptions', 'papersize', 'thanks', 'toc']);
        expect(facts.hasBody).toBe(true);
    });

    it('marks a named font and a package inside a conditional, and unconditional wins when loaded twice', () => {
        const facts = readTemplateFacts([
            '\\documentclass[10pt,twoside]{memoir}',
            '$if(fancy)$',
            '\\usepackage{lettrine}',
            '\\setsansfont{Inter}',
            '$if(inner)$\\usepackage{nested}$endif$',
            '\\usepackage{later}',
            '$endif$',
            '\\usepackage{lettrine}',
            '\\setmainfont[Numbers=OldStyle]{EB Garamond}',
            '\\setmonofont{JetBrains Mono}[Scale=0.9]',
            '\\newfontfamily\\headingfont{Cormorant}',
            '\\newfontfamily{\\capsfont}[Letters=SmallCaps]{EB Garamond}',
            '$body$',
        ].join('\n'));
        expect(facts.documentClass).toEqual({ kind: 'named', name: 'memoir', options: ['10pt', 'twoside'] });
        expect(facts.packages).toEqual([
            { name: 'lettrine', conditional: false },
            { name: 'nested', conditional: true },
            // Still inside the outer block after the inner one closed.
            { name: 'later', conditional: true },
        ]);
        expect(facts.fonts).toEqual([
            { role: 'sans', name: 'Inter', conditional: true },
            { role: 'main', name: 'EB Garamond', conditional: false },
            { role: 'mono', name: 'JetBrains Mono', conditional: false },
            { role: 'other', name: 'Cormorant', conditional: false },
        ]);
        expect(facts.otherVariables).toEqual(['fancy', 'inner']);
    });

    it('reads a 5 × 8 two-sided novel template for what it loads, whatever else it has', () => {
        const facts = readTemplateFacts([
            '\\documentclass[10pt,twoside,openright]{book}',
            '\\usepackage[paperwidth=5in,paperheight=8in,inner=0.8in,outer=0.6in]{geometry}',
            '\\usepackage{fontspec,setspace,lettrine,fancyhdr}',
            '\\setmainfont{EB Garamond}',
            '\\begin{document}',
            '\\tableofcontents',
            '$body$',
            '\\end{document}',
        ].join('\n'));
        expect(facts.documentClass).toEqual({ kind: 'named', name: 'book', options: ['10pt', 'twoside', 'openright'] });
        expect(facts.packages.map(item => item.name)).toEqual(['geometry', 'fontspec', 'setspace', 'lettrine', 'fancyhdr']);
        expect(facts.fonts).toEqual([{ role: 'main', name: 'EB Garamond', conditional: false }]);
        expect(facts.bookDetails).toEqual([]);
        expect(facts.readsHeaderIncludes).toBe(false);
    });

    it('reports nothing it cannot read', () => {
        expect(readTemplateFacts('')).toEqual({
            hasBody: false, documentClass: null, fonts: [], packages: [], bookDetails: [],
            readsHeaderIncludes: false, otherVariables: [], structuralMacros: false,
        });
    });
});

describe('structural macros', () => {
    it('are the template\'s only when it defines all three, outside comments', () => {
        expect(templateDefinesStructuralMacros('\\usepackage{epigraph}\n\\epigraph{q}{a}\n% modern classic\n$body$')).toBe(false);
        expect(templateDefinesStructuralMacros('\\newcommand{\\rtPart}[4]{}\n\\newcommand{\\rtSceneSep}[1]{}\n$body$')).toBe(false);
        expect(templateDefinesStructuralMacros('\\newcommand{\\rtPart}[4]{}\n\\providecommand\\rtChapter[2]{}\n\\renewcommand*{\\rtSceneSep}[1]{}\n$body$')).toBe(true);
        // \rtChapterTitle is another macro, not a definition of \rtChapter.
        expect(templateDefinesStructuralMacros('\\newcommand{\\rtPart}[4]{}\n\\newcommand{\\rtChapterTitle}{}\n\\newcommand{\\rtSceneSep}[1]{}')).toBe(false);
        expect(templateDefinesStructuralMacros('\\newcommand{\\rtPart}[4]{}\n% \\newcommand{\\rtChapter}[2]{}\n\\newcommand{\\rtSceneSep}[1]{}')).toBe(false);
    });
});

describe('stripLatexComments', () => {
    it('keeps escaped percent signs and removes the rest of a commented line', () => {
        expect(stripLatexComments('a % b\n50\\% off % note\nline\\\\% break then comment')).toBe('a \n50\\% off \nline\\\\');
    });
});

import { t } from '../i18n';

/** Document contents are built after cleanup, so generated navigation is never stripped. */
export function contentsDepth(value?: number): number {
    return value === undefined || !Number.isFinite(value) ? 3 : Math.max(1, Math.min(6, Math.floor(value) || 3)); // SAFE: invalid stored depths use the documented three-level default.
}

/** Obsidian block links also target explicit HTML anchors in other Markdown viewers. */
export function addMarkdownContents(text: string, depth = 3): string {
    const lines = text.split('\n');
    const entries: string[] = [];
    const body: string[] = [];
    const reserved = new Set(text.match(/manuscript-heading-\d+/g));
    const used = new Set<string>();
    let nextId = 1;
    let fence = '', fenceLength = 0, inComment = false;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (delimiter) {
            const mark = delimiter[1];
            if (!fence) { fence = mark[0]; fenceLength = mark.length; }
            else if (mark[0] === fence && mark.length >= fenceLength && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = '';
            body.push(line); continue;
        }
        const wasComment = inComment;
        if (line.includes('<!--')) inComment = !line.includes('-->', line.indexOf('<!--') + 4);
        else if (inComment && line.includes('-->')) inComment = false;
        if (!fence && !wasComment && !inComment && !line.includes('<!--')) {
            const atx = line.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
            const setext = /^ {0,3}\S/.test(line) && lines[index + 1]?.match(/^ {0,3}(=+|-+)\s*$/);
            const level = atx ? atx[1].length : setext ? (setext[1][0] === '=' ? 1 : 2) : 0;
            if (level && level <= depth) {
                const existingId = line.match(/\s+\^([\w-]+)\s*$/)?.[1];
                const title = (atx ? atx[2] : line.trim()).replace(/\s+\^[\w-]+\s*$/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[*_`]/g, '');
                while (reserved.has(`manuscript-heading-${nextId}`)) nextId++;
                const preserveId = existingId && !used.has(existingId);
                const id = preserveId ? existingId : `manuscript-heading-${nextId++}`;
                used.add(id);
                entries.push(`${'  '.repeat(level - 1)}- [${title.replace(/[[\]\\]/g, '\\$&')}](#^${id})`);
                body.push(`<a id="^${id}"></a>\n`);
                body.push(preserveId ? line : `${line.replace(/\s+\^[\w-]+\s*$/, '').replace(/\s+#+\s*$/, '')} ^${id}`);
                continue;
            }
        }
        body.push(line);
    }
    if (!entries.length) throw new Error(t('ui.exportFormats.contentsNoHeadings'));
    return `# Contents\n\n${entries.join('\n')}\n\n${body.join('\n')}`;
}

/** The layout flushes queued destinations only after it reaches the actual opener page. */
export function documentContentsHeader(depth: number): string {
    return String.raw`\usepackage{hyperref}
\hypersetup{hidelinks,bookmarksopen=true}
\makeatletter
\newcommand{\rtPendingNavigation}{}
\newcommand{\rtNavigationEntry}[2]{%
  \phantomsection
  \ifdefined\chapter
    \ifcase#1\or\addcontentsline{toc}{chapter}{#2}\or\addcontentsline{toc}{section}{#2}\or\addcontentsline{toc}{subsection}{#2}\fi
  \else
    \ifcase#1\or\addcontentsline{toc}{section}{#2}\or\addcontentsline{toc}{subsection}{#2}\or\addcontentsline{toc}{subsubsection}{#2}\fi
  \fi
}
\newcommand{\rtQueueNavigation}[2]{\g@addto@macro\rtPendingNavigation{\rtNavigationEntry{#1}{#2}}}
\providecommand{\rtNavigationFlush}{}
\renewcommand{\rtNavigationFlush}{\rtPendingNavigation\global\let\rtPendingNavigation\@empty}
\ifdefined\chapter
  \setcounter{tocdepth}{${depth - 1}}
  \hypersetup{bookmarksdepth=${depth - 1}}
\else
  \setcounter{tocdepth}{${depth}}
  \hypersetup{bookmarksdepth=${depth}}
\fi
\makeatother`;
}

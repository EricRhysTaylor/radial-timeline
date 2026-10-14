import { contentsDepth } from '../publishing/documentContents';
import { t } from '../i18n';

/*
 * Pandoc Lua filters for manuscript export. Pandoc parses the markdown, so a
 * filter only ever sees the nodes it rewrites: lists, code, tables and raw
 * LaTeX blocks pass through untouched.
 */

/**
 * One paragraph per source line, for scenes written with single returns. A
 * plain line break ends the paragraph; an explicit hard break (trailing
 * backslash) stays inside it for verse and letters. Paragraphs carrying raw
 * LaTeX/HTML are layout machinery and stay whole.
 */
const LINE_PER_PARAGRAPH_FILTER = `function Para(el)
  local out, cur, split = {}, {}, false
  for _, inline in ipairs(el.content) do
    if inline.t == 'RawInline' then return nil end
    if inline.t == 'SoftBreak' then
      split = true
      if #cur > 0 then out[#out + 1] = pandoc.Para(cur) end
      cur = {}
    else
      cur[#cur + 1] = inline
    end
  end
  if not split then return nil end
  if #cur > 0 then out[#out + 1] = pandoc.Para(cur) end
  return out
end
`;

/**
 * Word scene breaks: a horizontal rule (`---`, `***`) becomes a centered `#`,
 * styled by the reference document's "Scene Break" paragraph style. PDF
 * layouts draw their own scene breaks, so this is Word-only.
 */
const DOCX_SCENE_BREAK_FILTER = `function HorizontalRule()
  return pandoc.Div({ pandoc.Para({ pandoc.Str('#') }) }, pandoc.Attr('', {}, { { 'custom-style', 'Scene Break' } }))
end
`;

export function buildPandocLuaFilter(options: {
    targetFormat: 'pdf' | 'docx';
    lineBreaksAsParagraphs?: boolean;
    documentContents?: boolean;
    tocDepth?: number;
}): string | null {
    const filters: string[] = [];
    if (options.lineBreaksAsParagraphs) filters.push(LINE_PER_PARAGRAPH_FILTER);
    if (options.targetFormat === 'docx') filters.push(DOCX_SCENE_BREAK_FILTER);
    if (options.documentContents) filters.push(`function Pandoc(doc)
  local count = 0
  doc:walk({
    Header = function(el) if el.level <= ${contentsDepth(options.tocDepth)} then count = count + 1 end end,
    RawBlock = function(el) if el.text:find('rtQueueNavigation', 1, true) then count = count + 1 end end
  })
  if count == 0 then error(${JSON.stringify(t('ui.exportFormats.contentsNoHeadings'))}) end
  return doc
end`);
    return filters.length > 0 ? filters.join('\n') : null;
}

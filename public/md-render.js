(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MdRender = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function preserveIndent(markdown) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inFence = false;
    let fenceChar = '';

    for (const line of lines) {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const ch = fenceMatch[1].charAt(0);
        if (!inFence) {
          inFence = true;
          fenceChar = ch;
        } else if (ch === fenceChar) {
          inFence = false;
          fenceChar = '';
        }
        out.push(line);
        continue;
      }
      if (inFence) {
        out.push(line);
        continue;
      }
      const indentMatch = line.match(/^([ \t]+)(\S.*)$/);
      if (!indentMatch) {
        out.push(line);
        continue;
      }
      const rest = indentMatch[2];
      const isStructural =
        /^(?:[-+*]|\d+[.)])\s/.test(rest) ||
        /^>/.test(rest) ||
        /^\|/.test(rest) ||
        /^#{1,6}\s/.test(rest) ||
        /^(?:`{3,}|~{3,})/.test(rest) ||
        /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(rest);
      if (isStructural) {
        out.push(line);
        continue;
      }
      const indent = indentMatch[1]
        .replace(/ /g, '&nbsp;')
        .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
      out.push(indent + rest);
    }
    return out.join('\n');
  }

  function renderMarkdown(markdown, marked) {
    return marked.parse(preserveIndent(markdown), { gfm: true, breaks: true });
  }

  return { preserveIndent, renderMarkdown };
}));

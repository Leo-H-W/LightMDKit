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

  function splitTableCells(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(cell => cell.trim());
  }

  function isDelimiterRow(cells) {
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  // GFM 表格不支持多行单元格：当某个单元格内容换行时，marked 会把后续行
  // 解析成独立的新行。这里把跨行的单元格内容合并回同一行，用 <br> 表示换行。
  function mergeTableCells(markdown) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let numCols = null;

    while (i < lines.length) {
      const line = lines[i];

      if (numCols === null) {
        if (line.includes('|')) {
          const cells = splitTableCells(line);
          if (isDelimiterRow(cells)) {
            numCols = cells.length;
            out.push(line);
            i++;
            continue;
          }
        }
        out.push(line);
        i++;
        continue;
      }

      if (line.includes('|')) {
        const cells = splitTableCells(line);
        if (cells.length >= numCols) {
          out.push(line);
          i++;
          continue;
        }
        let merged = cells.slice();
        i++;
        while (i < lines.length && merged.length < numCols) {
          const cont = lines[i];
          if (/^\s*$/.test(cont)) break;
          if (cont.includes('|')) {
            const contCells = splitTableCells(cont);
            merged[merged.length - 1] += '<br>' + contCells[0];
            merged = merged.concat(contCells.slice(1));
          } else {
            merged[merged.length - 1] += '<br>' + cont.trim();
          }
          i++;
        }
        out.push('| ' + merged.join(' | ') + ' |');
        continue;
      }

      numCols = null;
      out.push(line);
      i++;
    }

    return out.join('\n');
  }

  function renderMarkdown(markdown, marked) {
    return marked.parse(preserveIndent(mergeTableCells(markdown)), { gfm: true, breaks: true });
  }

  return { preserveIndent, mergeTableCells, renderMarkdown };
}));

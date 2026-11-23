import JSZip from 'jszip';

const decode = (value: string) => value.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const withYellow = (body: string) => {
  const clean = body.replace(/<w:highlight\b[^>]*\/>/g, '');
  return /<w:rPr(?:\s[^>]*)?>/.test(clean)
    ? clean.replace(/<w:rPr(?:\s[^>]*)?>/, '$&<w:highlight w:val="yellow"/>')
    : `<w:rPr><w:highlight w:val="yellow"/></w:rPr>${clean}`;
};

/** Highlight only identified text spans, including values split across runs.
 * No visible text, paragraph, field, drawing, relationship or style part is removed. */
export function highlightProjectReviewText(xml: string, values: string[]) {
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const visible = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((item) => decode(item[1])).join('');
    const ranges: Array<{ start: number; end: number }> = [];
    const targets = new Set([...values.filter(Boolean), ...(visible.match(/\[PENDIENTE(?::[^\]]*)?\]|\*\* de \*\*\*\* de \*\*\*\*\*\*\*/g) || [])]);
    for (const target of targets) {
      let at = visible.indexOf(target);
      while (at >= 0) { ranges.push({ start: at, end: at + target.length }); at = visible.indexOf(target, at + target.length); }
    }
    if (!ranges.length) return paragraph;
    let offset = 0;
    return paragraph.replace(/<w:r(\s[^>]*)?>([\s\S]*?)<\/w:r>/g, (run, attrs = '', body: string) => {
      const nodes = [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
      const content = nodes.map((item) => decode(item[1])).join('');
      const start = offset; offset += content.length;
      const hits = ranges.filter((range) => range.start < offset && range.end > start);
      if (!hits.length) return run;
      // Complex runs may contain fields/drawings. Preserve them exactly and color
      // their containing run instead of cloning non-text XML.
      if (nodes.length !== 1 || body.replace(/<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/g, '').replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, '').trim()) {
        return `<w:r${attrs}>${withYellow(body)}</w:r>`;
      }
      const node = nodes[0];
      const prefix = body.slice(0, node.index); const suffix = body.slice(node.index! + node[0].length);
      const boundaries = [...new Set([0, content.length, ...hits.flatMap((range) => [Math.max(0, range.start - start), Math.min(content.length, range.end - start)])])].sort((a, b) => a - b);
      return boundaries.slice(0, -1).map((from, index) => {
        const to = boundaries[index + 1];
        const fragment = `${prefix}<w:t xml:space="preserve">${escape(content.slice(from, to))}</w:t>${suffix}`;
        const marked = hits.some((range) => range.start < start + to && range.end > start + from);
        return `<w:r${attrs}>${marked ? withYellow(fragment) : fragment}</w:r>`;
      }).join('');
    });
  });
}

export async function highlightProjectReviewBuffer(source: Buffer, values: string[]) {
  const zip = await JSZip.loadAsync(source);
  for (const name of Object.keys(zip.files).filter((item) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(item))) {
    const original = await zip.files[name].async('string');
    const highlighted = highlightProjectReviewText(original, values);
    if (highlighted !== original) zip.file(name, highlighted);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

import JSZip from 'jszip';

export type DirectedDocxPatch = { find: string; replace: string; target_paragraph_index?: number };

export type ProjectDocxPatchFailure = (status: number, code: string, message: string) => Error;

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decodeXml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlText = (xml: string) => xml
  .replace(/<w:tab\/?\s*>/g, '\t')
  .replace(/<w:(?:br|cr)\/?\s*>/g, '\n')
  .replace(/<\/w:p>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => decodeXml(entity))
  .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

async function visibleText(source: Buffer) {
  const zip = await JSZip.loadAsync(source);
  const names = Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
  return (await Promise.all(names.map(async (name) => xmlText(await zip.files[name].async('string'))))).join('\n');
}

/** Keep unchanged words in their original runs. A planner supplies a whole
 * paragraph, but moving that paragraph into its first run loses local fonts,
 * bold/italic labels and literal insert formatting. */
function replacementEdits(before: string, after: string) {
  const a = before.match(/\s+|\S+/g) || []; const b = after.match(/\s+|\S+/g) || [];
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const push = (start: number, end: number, value: string) => {
    let old = before.slice(start, end); let prefix = 0;
    while (prefix < old.length && prefix < value.length && old[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (suffix < old.length - prefix && suffix < value.length - prefix && old[old.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix++;
    old = old.slice(prefix, old.length - suffix);
    const replacement = value.slice(prefix, value.length - suffix);
    if (old !== replacement) edits.push({ start: start + prefix, end: end - suffix, value: replacement });
  };
  if ((a.length + 1) * (b.length + 1) > 4_000_000) { push(0, before.length, after); return edits; }
  const width = b.length + 1; const lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  }
  let i = 0; let j = 0; let offset = 0; let from = 0; let added = ''; let changing = false;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (changing) { push(from, offset, added); changing = false; added = ''; }
      offset += a[i++].length; j++;
    } else {
      if (!changing) { from = offset; changing = true; }
      if (j < b.length && (i === a.length || lcs[i * width + j + 1] > lcs[(i + 1) * width + j])) added += b[j++];
      else offset += a[i++].length;
    }
  }
  if (changing) push(from, offset, added);
  return edits;
}

function replaceAcrossTextRuns(paragraph: string, patch: DirectedDocxPatch) {
  const textPattern = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
  const nodes: Array<{ start: number; end: number; text: string }> = [];
  let match: RegExpExecArray | null; let offset = 0;
  while ((match = textPattern.exec(paragraph))) {
    const text = decodeXml(match[2]);
    nodes.push({ start: offset, end: offset + text.length, text });
    offset += text.length;
  }
  const joined = nodes.map((node) => node.text).join('');
  const normalizedRange = (haystack: string, needle: string) => {
    const canonical = (value: string, withMap = false) => {
      let text = ''; const map: number[] = []; let lastWasSpace = false;
      for (let index = 0; index < value.length; index += 1) {
        const expanded = value[index].normalize('NFKC')
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'")
          .replace(/[‐‑‒–—]/g, '-');
        for (const character of expanded) {
          const isSpace = /\s/.test(character);
          if (isSpace && lastWasSpace) continue;
          text += isSpace ? ' ' : character;
          if (withMap) map.push(index);
          lastWasSpace = isSpace;
        }
      }
      return { text, map };
    };
    const source = canonical(haystack, true);
    const target = canonical(needle).text;
    const at = source.text.indexOf(target);
    if (at < 0 || source.text.indexOf(target, at + 1) >= 0) return null;
    return { start: source.map[at], end: source.map[at + target.length - 1] + 1 };
  };
  const exactAt = joined.indexOf(patch.find);
  const equivalent = exactAt < 0 ? normalizedRange(joined, patch.find) : null;
  const at = exactAt >= 0 ? exactAt : equivalent?.start ?? -1;
  if (at < 0) return null;
  const finish = exactAt >= 0 ? at + patch.find.length : equivalent!.end;
  const changed = nodes.map((node) => ({ ...node }));
  for (const edit of replacementEdits(joined.slice(at, finish), patch.replace).reverse()) {
    const from = at + edit.start; const to = at + edit.end;
    if (from === to) {
      let index = changed.findIndex((node) => from >= node.start && from < node.end);
      if (index < 0 && from === joined.length) index = changed.length - 1;
      if (index < 0) return null;
      const position = from - changed[index].start;
      changed[index].text = changed[index].text.slice(0, position) + edit.value + changed[index].text.slice(position);
      continue;
    }
    const first = changed.findIndex((node) => from < node.end && to > node.start);
    let last = -1;
    for (let index = changed.length - 1; index >= 0; index--) if (from < changed[index].end && to > changed[index].start) { last = index; break; }
    if (first < 0 || last < 0) return null;
    const prefix = changed[first].text.slice(0, Math.max(0, from - changed[first].start));
    const suffix = changed[last].text.slice(Math.max(0, to - changed[last].start));
    changed[first].text = `${prefix}${edit.value}${first === last ? suffix : ''}`;
    for (let index = first + 1; index < last; index++) changed[index].text = '';
    if (last !== first) changed[last].text = suffix;
  }
  let nodeIndex = 0;
  return paragraph.replace(textPattern, (_full, open, _raw, close) => `${open}${escapeXml(changed[nodeIndex++].text)}${close}`);
}

export async function applyDirectedDocxPatches(
  source: Buffer,
  patches: DirectedDocxPatch[],
  failure: ProjectDocxPatchFailure,
) {
  const zip = await JSZip.loadAsync(source);
  const entry = zip.file('word/document.xml');
  if (!entry) throw failure(422, 'PROJECT_DOCX_INVALID', 'El proyecto no contiene un documento Word válido.');
  let xml = await entry.async('string');
  const before = await visibleText(source);
  const diff: Array<{ find: string; replace: string; occurrences: number }> = [];
  for (const patch of patches) {
    const occurrences = before.split(patch.find).length - 1;
    const hasDirectedParagraph = Number.isInteger(patch.target_paragraph_index) && Number(patch.target_paragraph_index) >= 0;
    if ((!hasDirectedParagraph && occurrences !== 1) || occurrences < 1) throw failure(
      409,
      occurrences ? 'PROJECT_PATCH_AMBIGUOUS' : 'PROJECT_PATCH_TARGET_NOT_FOUND',
      occurrences ? `El texto “${patch.find.slice(0, 80)}” aparece más de una vez; precisa la indicación.` : `No se encontró “${patch.find.slice(0, 80)}” en la versión vigente.`,
    );
    let replaced = false;
    let paragraphIndex = -1;
    xml = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
      paragraphIndex += 1;
      if (replaced) return paragraph;
      if (hasDirectedParagraph && paragraphIndex !== patch.target_paragraph_index) return paragraph;
      const next = replaceAcrossTextRuns(paragraph, patch);
      if (!next) return paragraph;
      replaced = true;
      return next;
    });
    if (!replaced) throw failure(409, 'PROJECT_PATCH_TARGET_NOT_CONTIGUOUS', `El texto “${patch.find.slice(0, 80)}” no puede corregirse de forma segura sin alterar el formato.`);
    diff.push({ ...patch, occurrences });
  }
  zip.file('word/document.xml', xml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, before, after: await visibleText(buffer), diff };
}

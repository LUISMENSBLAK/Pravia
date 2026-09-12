import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

/** Extracts visible paragraph text from a DOCX using the project's pinned XML parser. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('El archivo DOCX no contiene word/document.xml.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = Array.from(document.getElementsByTagName('w:p'));
  return paragraphs
    .map((paragraph) => Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent || '').join(''))
    .filter(Boolean)
    .join('\n');
}

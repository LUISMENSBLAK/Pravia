import { Fragment, type ReactNode } from 'react';
import styles from './AssistantDrawer.module.css';

const inlinePattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g;

const safeHref = (value: string) => {
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
};

const plainText = (value: string) => value.replaceAll('**', '').replaceAll('__', '');

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(plainText(value.slice(cursor, index)));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      nodes.push(<strong key={key}>{plainText(token.slice(2, -2))}</strong>);
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      nodes.push(<em key={key}>{plainText(token.slice(1, -1))}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeHref(link[2]) : null;
      nodes.push(href
        ? <a key={key} href={href} target={href.startsWith('/') ? undefined : '_blank'} rel={href.startsWith('/') ? undefined : 'noreferrer'}>{link?.[1]}</a>
        : plainText(link?.[1] ?? token));
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) nodes.push(plainText(value.slice(cursor)));
  return nodes;
}

type ListBlock = { type: 'ul' | 'ol'; items: string[]; start?: number };
type TextBlock = { type: 'paragraph' | 'heading' | 'quote'; lines: string[] };
type Block = ListBlock | TextBlock;

const toBlocks = (content: string): Block[] => {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^\s*#{1,3}\s+(.+)$/);
    if (heading) { blocks.push({ type: 'heading', lines: [heading[1]] }); index += 1; continue; }
    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) { blocks.push({ type: 'quote', lines: [quote[1]] }); index += 1; continue; }
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*[-+*]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]); index += 1;
      }
      blocks.push({ type: 'ul', items }); continue;
    }
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      const items: string[] = [];
      const start = Number(ordered[1]);
      while (index < lines.length) {
        const item = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]); index += 1;
      }
      blocks.push({ type: 'ol', items, start }); continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && /^\s*(?:[-+*]\s+|\d+[.)]\s+|#{1,3}\s+|>\s?)/.test(lines[index])) break;
      paragraph.push(lines[index].trim()); index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
  }
  return blocks;
};

export function AssistantMarkdown({ content }: { content: string }) {
  const blocks = toBlocks(content);
  return <div className={styles.markdown}>{blocks.map((block, index) => {
    const key = `block-${index}`;
    if (block.type === 'ul' || block.type === 'ol') {
      const List = block.type;
      return <List key={key} start={block.type === 'ol' ? block.start : undefined}>{block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}</List>;
    }
    if (block.type === 'heading') return <h3 key={key}>{renderInline(block.lines[0], key)}</h3>;
    if (block.type === 'quote') return <blockquote key={key}>{renderInline(block.lines[0], key)}</blockquote>;
    if (block.type === 'paragraph') return <p key={key}>{block.lines.map((line, lineIndex) => <Fragment key={`${key}-${lineIndex}`}>{lineIndex > 0 && <br />}{renderInline(line, `${key}-${lineIndex}`)}</Fragment>)}</p>;
    return null;
  })}</div>;
}

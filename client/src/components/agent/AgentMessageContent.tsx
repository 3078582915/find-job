import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s）)]+)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-[#17324D]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-[#EEF2F5] px-1.5 py-0.5 text-[0.9em] text-[#38536A]">{part.slice(1, -1)}</code>;
    }
    if (/^https?:\/\//.test(part)) {
      return <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all text-[#2E6B9A] underline decoration-[#A9C1D2] underline-offset-2 hover:text-accent">{part}</a>;
    }
    return part;
  });
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderBlocks(content: string) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || /^-{3,}$/.test(line)) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(<div key={`h-${index}`} className={`${level === 1 ? 'text-base' : 'text-[15px]'} mt-3 font-semibold text-[#17324D]`}>{renderInline(heading[2])}</div>);
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="my-3 overflow-x-auto rounded-md border border-[#E2E8ED]">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead className="bg-[#F5F8FA] text-[#476177]">
              <tr>{headers.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-[#E2E8ED] px-3 py-2 font-semibold">{renderInline(cell)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[#EDF1F4]">
              {rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top text-[#536B7E]">{renderInline(row[cellIndex] || '')}</td>)}</tr>)}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = line.match(/^[-*]s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = orderedList ? current.match(/^\d+[.)]\s+(.+)$/) : current.match(/^[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      const className = `my-2 space-y-1 pl-5 text-sm leading-6 text-[#39536A] ${orderedList ? 'list-decimal' : 'list-disc'}`;
      blocks.push(orderedList
        ? <ol key={`list-${index}`} className={className}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ol>
        : <ul key={`list-${index}`} className={className}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>);
      continue;
    }

    const paragraph: string[] = [lines[index].trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,3})\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break;
      if (next.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`} className="my-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#39536A]">{renderInline(paragraph.join('\n'))}</p>);
  }

  return blocks;
}

function splitReceipt(content: string) {
  const receipts = [...content.matchAll(/数据库入库回执：[^\n]*/g)].map((match) => match[0]);
  return {
    body: content.replace(/(^|\n)\s*数据库入库回执：[^\n]*/g, '$1').replace(/\n{3,}/g, '\n\n').trim(),
    receipt: receipts[receipts.length - 1] || '',
  };
}

export default function AgentMessageContent({ content }: { content: string }) {
  const { body, receipt } = splitReceipt(content);
  return (
    <div>
      {body && <div>{renderBlocks(body)}</div>}
      {receipt && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-[#CFE7DC] bg-[#F1FAF6] px-3 py-2.5 text-xs leading-5 text-[#276449]">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span>{receipt.replace(/^数据库入库回执：/, '')}</span>
        </div>
      )}
    </div>
  );
}

// A tiny PDF writer: one or more A4/Letter pages of text and rules in Helvetica,
// enough for a scoresheet. No library; the standard fonts need no embedding.

export interface PdfText { kind: 'text'; x: number; y: number; text: string; size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; gray?: boolean }
export interface PdfLine { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width?: number; gray?: boolean }
export type PdfItem = PdfText | PdfLine;

/** US Letter in points; y runs down from the top in the items and is flipped on output. */
export const PAGE = { w: 612, h: 792, margin: 48 };

// WinAnsi codes for the few characters outside Latin-1 that the app writes.
const WIN: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80, '−': 0x2d, '′': 0x27, '″': 0x22, '×': 0xd7 };
const encode = (s: string) => {
  let out = '';
  for (const ch of s) {
    const c = WIN[ch] ?? ch.charCodeAt(0);
    const b = c > 255 ? 0x3f : c;   // '?' for anything else
    const e = String.fromCharCode(b);
    out += e === '(' || e === ')' || e === '\\' ? `\\${e}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : e;
  }
  return out;
};

// Helvetica advance widths (per 1000 em) for printable ASCII 32–126; others ~556.
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
export function textWidth(s: string, size: number, bold = false) {
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; }
  return (w * size * (bold ? 1.05 : 1)) / 1000;
}

export function buildPdf(pages: PdfItem[][], title = 'Electro-Coach'): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add(''), pagesId = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const items of pages) {
    const ops: string[] = [];
    for (const it of items) {
      if (it.kind === 'line') {
        ops.push(`${it.gray ? '0.6 G' : '0 G'} ${(it.width ?? 0.75).toFixed(2)} w ${it.x1.toFixed(1)} ${(PAGE.h - it.y1).toFixed(1)} m ${it.x2.toFixed(1)} ${(PAGE.h - it.y2).toFixed(1)} l S`);
      } else {
        const size = it.size ?? 10;
        const w = textWidth(it.text, size, it.bold);
        const x = it.align === 'right' ? it.x - w : it.align === 'center' ? it.x - w / 2 : it.x;
        ops.push(`BT ${it.gray ? '0.4 g' : '0 g'} /${it.bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${(PAGE.h - it.y).toFixed(1)} Td (${encode(it.text)}) Tj ET`);
      }
    }
    const stream = ops.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${encode(title)}) /Producer (Electro-Coach) >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character above is a single byte (encode() keeps to 0–255).
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

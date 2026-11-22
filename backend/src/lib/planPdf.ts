import PDFDocument from 'pdfkit';
import { formatMinutes } from './timeGrid';
import { CLASS_LETTER, CLASS_NAME, printLanes, timeWindow, type PrintDocument, type PrintPage } from './planPrint';
import { collectPdf, registerFonts } from './pdfFonts';

/**
 * Rysowanie druku planu (A4 poziomo) — pdfkit, bez bazy. Strony przychodza gotowe
 * (lib/planPrint); tu tylko geometria: os minut, kolumny, kafelki w torach, stopka.
 * Czcionka DejaVu Sans Condensed — polskie znaki i waskie kafelki.
 */

const PAGE = { width: 841.89, height: 595.28 };
const MARGIN = 24;
const HEADER_H = 46;
const COLUMN_HEAD_H = 24;
const FOOTER_H = 16;
const AXIS_W = 30;

/** Pastelowe wypelnienie i pasek z lewej wg formy zajec — czytelne takze w druku czarno-bialym. */
const COLORS: Record<string, { fill: string; bar: string }> = {
  LECTURE: { fill: '#dbeafe', bar: '#2563eb' },
  EXERCISE: { fill: '#dcfce7', bar: '#16a34a' },
  LAB: { fill: '#ffedd5', bar: '#ea580c' },
  PROJECT: { fill: '#f3e8ff', bar: '#9333ea' },
  SEMINAR: { fill: '#f1f5f9', bar: '#475569' },
};
const LINE_COLOR = '#d4d4d8';
const MUTED = '#71717a';
const TEXT = '#18181b';

export function renderPlanPdf(document: PrintDocument, generatedAt: Date = new Date()): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: document.title, Creator: 'Planista 10' },
  });
  registerFonts(doc);
  const done = collectPdf(doc);

  const pages = document.pages.length > 0 ? document.pages : [{ heading: document.title, subheading: '', columns: [], entries: [], emptyText: 'Brak zajęć w planie.' }];
  pages.forEach((page, i) => {
    if (i > 0) doc.addPage();
    drawPage(doc, page);
  });

  // Stopka na kazdej stronie: semestr, legenda form, data wydruku, numer strony.
  const stamp = `${String(generatedAt.getDate()).padStart(2, '0')}.${String(generatedAt.getMonth() + 1).padStart(2, '0')}.${generatedAt.getFullYear()} ${String(generatedAt.getHours()).padStart(2, '0')}:${String(generatedAt.getMinutes()).padStart(2, '0')}`;
  const legend = Object.entries(CLASS_LETTER)
    .map(([type, letter]) => `${letter} – ${CLASS_NAME[type]}`)
    .join(', ');
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = PAGE.height - MARGIN - FOOTER_H + 6;
    doc.font('regular').fontSize(7).fillColor(MUTED);
    doc.text(`Semestr ${document.termLabel} · ${legend}`, MARGIN, y, { lineBreak: false });
    doc.text(`wydruk ${stamp} · strona ${i + 1} z ${range.count}`, MARGIN, y, { width: PAGE.width - 2 * MARGIN, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

function drawPage(doc: PDFKit.PDFDocument, page: PrintPage) {
  const left = MARGIN;
  const right = PAGE.width - MARGIN;
  doc.font('bold').fontSize(14).fillColor(TEXT).text(page.heading, left, MARGIN, { width: right - left, lineBreak: false, ellipsis: true });
  doc.font('regular').fontSize(9).fillColor(MUTED).text(page.subheading, left, MARGIN + 20, { width: right - left, height: 22, ellipsis: true });

  const top = MARGIN + HEADER_H;
  const bottom = PAGE.height - MARGIN - FOOTER_H;
  if (page.columns.length === 0) {
    doc.font('regular').fontSize(11).fillColor(MUTED).text(page.emptyText ?? 'Brak zajęć.', left, top + 40, { width: right - left, align: 'center' });
    return;
  }

  const gridLeft = left + AXIS_W;
  const colW = (right - gridLeft) / page.columns.length;
  const gridTop = top + COLUMN_HEAD_H;
  const { start, end } = timeWindow(page.entries);
  const perMinute = (bottom - gridTop) / (end - start);
  const yOf = (minute: number) => gridTop + (minute - start) * perMinute;

  // Naglowki kolumn.
  page.columns.forEach((c, i) => {
    const x = gridLeft + i * colW;
    doc.rect(x, top, colW, COLUMN_HEAD_H).fill('#f4f4f5');
    doc.font('bold').fontSize(9).fillColor(TEXT).text(c.label, x, top + (c.sublabel ? 3 : 8), { width: colW, align: 'center', lineBreak: false });
    if (c.sublabel) doc.font('regular').fontSize(8).fillColor(MUTED).text(c.sublabel, x, top + 13, { width: colW, align: 'center', lineBreak: false });
  });

  // Dni bez zajec (swieto, przerwa, dzien wolny) — kolumna wyszarzona z opisem, zeby pusta
  // kolumna nie wygladala na blad planu.
  page.columns.forEach((c, i) => {
    if (!c.closed) return;
    const x = gridLeft + i * colW;
    doc.rect(x, gridTop, colW, bottom - gridTop).fill('#f4f4f5');
    doc.font('bold').fontSize(9).fillColor(MUTED).text('Dzień wolny', x + 6, gridTop + 24, { width: colW - 12, align: 'center' });
    doc.font('regular').fontSize(8).fillColor(MUTED).text(c.closed, x + 6, gridTop + 37, { width: colW - 12, align: 'center' });
  });

  // Os czasu: pelne godziny (linie przez cala szerokosc).
  doc.lineWidth(0.5);
  for (let m = start; m <= end; m += 60) {
    const y = yOf(m);
    doc.moveTo(gridLeft, y).lineTo(right, y).strokeColor(LINE_COLOR).stroke();
    if (m < end) doc.font('regular').fontSize(7).fillColor(MUTED).text(formatMinutes(m), left, y + 2, { width: AXIS_W - 4, align: 'right', lineBreak: false });
  }
  for (let i = 0; i <= page.columns.length; i++) {
    const x = gridLeft + i * colW;
    doc.moveTo(x, top).lineTo(x, bottom).strokeColor(LINE_COLOR).stroke();
  }

  if (page.entries.length === 0 && page.emptyText) {
    doc.font('regular').fontSize(10).fillColor(MUTED).text(page.emptyText, gridLeft, gridTop + 30, { width: right - gridLeft, align: 'center' });
  }

  // Kafelki zajec w torach kolumny.
  page.columns.forEach((c, i) => {
    const entries = page.entries.filter((e) => e.column === c.key);
    const lanes = printLanes(entries);
    for (const e of entries) {
      const lane = lanes.get(e.id) ?? { lane: 0, span: 1, lanes: 1 };
      const laneW = colW / lane.lanes;
      const x = gridLeft + i * colW + lane.lane * laneW + 1;
      const w = laneW * lane.span - 2;
      const y = yOf(e.startMinute) + 0.5;
      const h = yOf(e.endMinute) - yOf(e.startMinute) - 1;
      drawEntry(doc, e, x, y, w, h);
    }
  });
}

function drawEntry(doc: PDFKit.PDFDocument, e: PrintPage['entries'][number], x: number, y: number, w: number, h: number) {
  const color = COLORS[e.classType] ?? COLORS.SEMINAR!;
  doc.save();
  doc.rect(x, y, w, h).fill(color.fill);
  doc.rect(x, y, 2, h).fill(color.bar);
  doc.rect(x, y, w, h).clip();

  const pad = 2;
  const textX = x + 2 + pad;
  const textW = Math.max(w - 2 - 2 * pad, 4);
  // Waski kafelek (wiele torow) — mniejsza czcionka.
  const size = w < 60 ? 6 : 7;
  const time = `${formatMinutes(e.startMinute)}–${formatMinutes(e.endMinute)}`;
  const title = `${CLASS_LETTER[e.classType] ?? e.classType} · ${e.title}`;
  doc.font('bold').fontSize(size).fillColor(TEXT);
  const titleH = doc.currentLineHeight(true);
  // Tytul do 2 linii, gdy jest miejsce; dalej godziny i opis, dopoki sie mieszcza (wysokosc
  // z zapasem 0,5 pt — pdfkit nie rysuje linii, ktora nie miesci sie w `height` w calosci).
  const titleLines = h >= titleH * 4 ? 2 : 1;
  doc.text(title, textX, y + pad, { width: textW, height: titleH * titleLines + 0.5, ellipsis: true, lineGap: 0 });
  let cy = doc.y + 0.5;
  doc.font('regular').fontSize(size - 0.5).fillColor(TEXT);
  const lineH = doc.currentLineHeight(true);
  // Kazda linia w pelnej wersji, a gdy sie nie miesci — w krotkiej (sala bez budynku, inicjal).
  const pick = (i: number, render: (text: string) => string) => {
    const full = render(e.lines[i]!);
    const short = e.compactLines?.[i];
    return short !== undefined && doc.widthOfString(full) > textW ? render(short) : full;
  };
  const lines = e.lines.length > 0 ? [pick(0, (t) => `${time} · ${t}`), ...e.lines.slice(1).map((_, i) => pick(i + 1, (t) => t))] : [time];
  for (const line of lines) {
    // Ostatnia linia moze nieco wejsc w dolny margines kafelka (kafelek jest przyciety).
    if (cy + lineH * 0.85 > y + h) break;
    doc.text(line, textX, cy, { width: textW, height: lineH + 0.5, ellipsis: true, lineGap: 0 });
    cy += lineH;
  }
  doc.restore();
}

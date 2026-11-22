import PDFDocument from 'pdfkit';
import { collectPdf, registerFonts } from './pdfFonts';
import { abbreviateSubject, FORM_SHORT, subjectColor, type SheetColumn, type SheetDay, type SheetDocument, type SheetItem, type SheetSpan } from './planSheet';

/**
 * Rysowanie arkusza planu dla studentow (lib/planSheet) — wyglad arkuszy Excela WM:
 * stacjonarne A4 pionowo, caly tydzien na jednej stronie; niestacjonarne A4 poziomo, dni zjazdow
 * po kolei (dzien nie jest dzielony miedzy strony, naglowek kolumn na kazdej stronie).
 */

const A4 = { short: 595.28, long: 841.89 };
const MARGIN = 16;
const TITLE_H = 16;
const HEAD_ROW = 10;
const NOTE_LINE = 7.5;
const PAGE_NO_H = 8;
const PART_TIME_ROW = 13.5;

const BLACK = '#000000';
const BLUE = '#1f6fb4';
const RED = '#e00000';
const NOTE_RED = '#c00000';
const GREY = '#e7e6e6';
const CLOSED_FILL = '#ff9b9b';

interface Geometry {
  width: number;
  height: number;
  dayW: number;
  timeW: number;
  gridLeft: number;
  colW: number;
  right: number;
  rowH: number;
}

export function renderSheetPdf(sheet: SheetDocument): Promise<Buffer> {
  const fullTime = sheet.mode === 'FULL_TIME';
  const doc = new PDFDocument({
    size: 'A4',
    layout: fullTime ? 'portrait' : 'landscape',
    // Marginesy liczymy sami; zerowy margines pdfkit nie przenosi tekstu przy dolnej krawedzi na nowa strone.
    margin: 0,
    bufferPages: true,
    info: { Title: sheet.title, Creator: 'Planista 10' },
  });
  registerFonts(doc);
  const done = collectPdf(doc);

  const width = fullTime ? A4.short : A4.long;
  const height = fullTime ? A4.long : A4.short;
  const dayW = fullTime ? 22 : 34;
  const timeW = fullTime ? 18 : 24;
  const gridLeft = MARGIN + dayW + timeW;
  const right = width - MARGIN;
  const colW = (right - gridLeft) / Math.max(sheet.columns.length, 1);
  const notesH = sheet.notes.length > 0 ? sheet.notes.length * NOTE_LINE + 4 : 0;
  const bodyTop = MARGIN + TITLE_H + 2 * HEAD_ROW;
  const dayRows = (d: SheetDay) => (d.closed ? 1 : Math.max(d.rows.length, 1));

  let rowH: number;
  if (fullTime) {
    const total = sheet.days.reduce((n, d) => n + dayRows(d), 0);
    rowH = Math.min(22, (height - MARGIN - bodyTop - notesH) / Math.max(total, 1));
  } else rowH = PART_TIME_ROW;
  const g: Geometry = { width, height, dayW, timeW, gridLeft, colW, right, rowH };

  const startPage = () => {
    drawHeader(doc, sheet, g);
    return bodyTop;
  };

  let y = startPage();
  let first = true;
  const bottomLimit = height - MARGIN - (fullTime ? notesH : PAGE_NO_H);
  if (sheet.days.length === 0 || sheet.columns.length === 0) {
    doc.font('regular').fontSize(10).fillColor('#71717a').text('Brak ułożonych zajęć.', MARGIN, bodyTop + 30, { width: width - 2 * MARGIN, align: 'center' });
  }
  for (const day of sheet.days) {
    const h = dayRows(day) * rowH;
    if (!fullTime && !first && y + h > bottomLimit) {
      doc.addPage();
      y = startPage();
    }
    drawDay(doc, sheet, day, y, g);
    y += h;
    first = false;
  }
  drawBandSeparators(doc, sheet.columns, g, MARGIN + TITLE_H, y);

  if (sheet.notes.length > 0) {
    if (!fullTime && y + notesH > height - MARGIN - PAGE_NO_H) {
      doc.addPage();
      y = startPage();
    }
    doc.font('regular').fontSize(6).fillColor(NOTE_RED);
    sheet.notes.forEach((note, i) => {
      doc.text(i === 0 ? note : `• ${note}`, MARGIN + 6, y + 3 + i * NOTE_LINE, { lineBreak: false });
    });
  }

  if (!fullTime) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('regular').fontSize(6).fillColor('#71717a');
      const text = `Semestr ${sheet.termLabel} · strona ${i + 1} z ${range.count}`;
      doc.text(text, width - MARGIN - doc.widthOfString(text), height - MARGIN - PAGE_NO_H + 2, { lineBreak: false });
    }
  }
  doc.end();
  return done;
}

function drawHeader(doc: PDFKit.PDFDocument, sheet: SheetDocument, g: Geometry) {
  const top = MARGIN;
  doc.font('regular').fontSize(5.5).fillColor(BLUE).text('uaktualnienie', MARGIN, top + 7, { lineBreak: false });
  doc.font('bold').fontSize(6.5).fillColor(BLUE).text(sheet.updated, MARGIN + 40, top + 6, { lineBreak: false });
  doc.font('bold').fontSize(10.5).fillColor(BLACK);
  centerLine(doc, sheet.title, g.gridLeft, top + 2, g.right - g.gridLeft);

  const headTop = top + TITLE_H;
  doc.lineWidth(0.5).strokeColor(BLACK);
  // Lewy naglowek: "specjalność" / "grupa".
  const leftW = g.gridLeft - MARGIN;
  doc.rect(MARGIN, headTop, leftW, 2 * HEAD_ROW).stroke();
  doc.font('regular').fontSize(5.5).fillColor(BLACK);
  for (const [i, label] of sheet.headLabels.entries()) {
    doc.text(label, MARGIN + leftW - 3 - doc.widthOfString(label), headTop + i * HEAD_ROW + 2.5, { lineBreak: false });
  }

  // Pasma (kierunek / rok) — sasiednie kolumny z tym samym pasmem scalone.
  let c = 0;
  while (c < sheet.columns.length) {
    let to = c;
    while (to + 1 < sheet.columns.length && sheet.columns[to + 1]!.band === sheet.columns[c]!.band) to++;
    const x = g.gridLeft + c * g.colW;
    const w = (to - c + 1) * g.colW;
    doc.rect(x, headTop, w, HEAD_ROW).stroke();
    fitText(doc, 'bold', 7, sheet.columns[c]!.band, x, headTop, w, HEAD_ROW);
    c = to + 1;
  }
  sheet.columns.forEach((col, i) => {
    const x = g.gridLeft + i * g.colW;
    doc.rect(x, headTop + HEAD_ROW, g.colW, HEAD_ROW).stroke();
    fitText(doc, 'bold', 6, col.label, x, headTop + HEAD_ROW, g.colW, HEAD_ROW);
  });
}

/**
 * Linia tekstu wysrodkowana w [x, x+w] bez zawijania (pdfkit z `width` zawija mimo `lineBreak: false`);
 * za dluga — od lewej krawedzi (komorka ja przytnie).
 */
function centerLine(doc: PDFKit.PDFDocument, text: string, x: number, y: number, w: number) {
  const tw = doc.widthOfString(text);
  doc.text(text, tw <= w - 1 ? x + (w - tw) / 2 : x + 0.5, y, { lineBreak: false });
}

/** Tekst w jednej linii, wysrodkowany; czcionka zmniejszana (do 3,5 pt), az sie zmiesci. */
function fitText(doc: PDFKit.PDFDocument, font: string, size: number, text: string, x: number, y: number, w: number, h: number, color = BLACK) {
  let fs = size;
  doc.font(font).fontSize(fs);
  while (fs > 3.5 && doc.widthOfString(text) > w - 2) {
    fs -= 0.25;
    doc.fontSize(fs);
  }
  doc.save();
  doc.rect(x, y, w, h).clip();
  doc.fillColor(color);
  centerLine(doc, text, x, y + (h - fs * 1.15) / 2, w);
  doc.restore();
}

/** Grube linie miedzy pasmami (kierunkami / latami) przez naglowek i tresc strony. */
function drawBandSeparators(doc: PDFKit.PDFDocument, columns: SheetColumn[], g: Geometry, top: number, bottom: number) {
  const range = doc.bufferedPageRange();
  const current = range.start + range.count - 1;
  for (let p = range.start; p <= current; p++) {
    doc.switchToPage(p);
    const pageBottom = p === current ? bottom : g.height - MARGIN - PAGE_NO_H;
    doc.lineWidth(1.2).strokeColor(BLACK);
    for (let c = 1; c < columns.length; c++) {
      if (columns[c]!.band === columns[c - 1]!.band) continue;
      const x = g.gridLeft + c * g.colW;
      doc.moveTo(x, top).lineTo(x, pageBottom).stroke();
    }
  }
}

function drawDay(doc: PDFKit.PDFDocument, sheet: SheetDocument, day: SheetDay, top: number, g: Geometry) {
  const fullTime = sheet.mode === 'FULL_TIME';
  const rows = day.closed ? 1 : Math.max(day.rows.length, 1);
  const h = rows * g.rowH;
  doc.lineWidth(0.5).strokeColor(BLACK);

  // Komorka dnia: "Pn" albo "tydz: 1 / Sobota / 3 paź".
  doc.rect(MARGIN, top, g.dayW, h).stroke();
  if (fullTime) {
    fitText(doc, 'regular', Math.min(14, h / 2), day.label, MARGIN, top, g.dayW, h);
  } else {
    if (day.week) fitText(doc, 'regular', 5.5, day.week, MARGIN, top + 1, g.dayW, 8);
    const mid = top + h / 2;
    fitText(doc, 'regular', 6, day.label, MARGIN, mid - 8, g.dayW, 8);
    if (day.sublabel) fitText(doc, 'bold', 6.5, day.sublabel, MARGIN, mid, g.dayW, 8);
  }

  if (day.closed) {
    doc.rect(MARGIN + g.dayW, top, g.right - MARGIN - g.dayW, h).fillAndStroke(CLOSED_FILL, BLACK);
    fitText(doc, 'bold', 7, day.closed, MARGIN + g.dayW, top, g.right - MARGIN - g.dayW, h);
    doc.lineWidth(1.2).moveTo(MARGIN, top + h).lineTo(g.right, top + h).stroke();
    return;
  }

  day.rows.forEach((row, r) => {
    const y = top + r * g.rowH;
    doc.lineWidth(0.5).rect(MARGIN + g.dayW, y, g.timeW, g.rowH).stroke();
    fitText(doc, 'regular', fullTime ? Math.min(8, g.rowH * 0.6) : 6, row.label, MARGIN + g.dayW, y, g.timeW, g.rowH);
    const covered = sheet.columns.map(() => false);
    for (const s of day.layout.spans) if (s.row === r) for (let c = s.colFrom; c <= s.colTo; c++) covered[c] = true;
    sheet.columns.forEach((_, c) => {
      if (covered[c]) return;
      const x = g.gridLeft + c * g.colW;
      if (day.greyIdle && day.layout.idle[c]) doc.rect(x, y, g.colW, g.rowH).fillAndStroke(GREY, BLACK);
      else doc.rect(x, y, g.colW, g.rowH).stroke();
    });
  });

  for (const s of day.layout.spans) drawSpan(doc, s, top + s.row * g.rowH, g);

  for (const f of day.layout.frames) {
    const x1 = g.gridLeft + f.colFrom * g.colW;
    const x2 = g.gridLeft + (f.colTo + 1) * g.colW;
    const y1 = top + f.rowFrom * g.rowH;
    const y2 = top + (f.rowTo + 1) * g.rowH;
    doc.lineWidth(0.35).strokeColor('#4a7ebb').moveTo(x1, y1).lineTo((x1 + x2) / 2, y2).lineTo(x2, y1).stroke();
    doc.lineWidth(1.2).strokeColor(RED).roundedRect(x1 + 0.6, y1 + 0.6, x2 - x1 - 1.2, y2 - y1 - 1.2, 3).stroke();
  }

  doc.lineWidth(1.2).strokeColor(BLACK).moveTo(MARGIN, top + h).lineTo(g.right, top + h).stroke();
}

function drawSpan(doc: PDFKit.PDFDocument, s: SheetSpan, y: number, g: Geometry) {
  const x = g.gridLeft + s.colFrom * g.colW;
  const w = (s.colTo - s.colFrom + 1) * g.colW;
  const h = g.rowH;
  doc.lineWidth(0.5);
  doc.rect(x, y, w, h).fillAndStroke(subjectColor(s.items[0]!.subject), BLACK);

  const single = s.items.length === 1;
  // Jedna wielkosc liter na arkuszu (3 linie: przedmiot, sala, prowadzacy); wiecej wpisow — mniejsza.
  const lineCount = Math.max(3, single ? 3 : s.items.length);
  const fs = Math.max(3, Math.min(6, (h - 0.5) / (lineCount * 1.12)));
  const lineH = fs * 1.12;
  doc.font('regular').fontSize(fs);
  const fits = (form: string) => (text: string) => doc.widthOfString(`${text} ${form}`) <= w - 2;
  const title = (i: SheetItem) => {
    const form = FORM_SHORT[i.classType] ?? '';
    return `${abbreviateSubject(i.subject, fits(form))} ${form}`.trim();
  };
  const lines = single
    ? [title(s.items[0]!), s.items[0]!.room, s.items[0]!.person].filter(Boolean)
    : s.items.map((i) => [title(i), i.room].filter(Boolean).join(' '));

  doc.save();
  doc.rect(x, y, w, h).clip();
  doc.fillColor(BLACK);
  const y0 = y + (h - lines.length * lineH) / 2;
  lines.forEach((line, i) => {
    centerLine(doc, line, x, y0 + i * lineH - fs * 0.05, w);
  });
  doc.restore();
}

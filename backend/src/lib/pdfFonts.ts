/**
 * Czcionki drukow PDF (pdfkit): DejaVu Sans Condensed — polskie znaki i waskie komorki.
 * Rejestrowane pod nazwami 'regular' i 'bold'.
 */
const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf');

export function registerFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont('regular', FONT);
  doc.registerFont('bold', FONT_BOLD);
}

/** Zbiera strumien pdfkit do bufora (wywolaj przed doc.end()). */
export function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

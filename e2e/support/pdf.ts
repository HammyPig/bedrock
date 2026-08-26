import path from "node:path";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** pdf.js ships the fonts a PDF may reference by name rather than embed. */
const STANDARD_FONTS = path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/");

/**
 * Every word in a PDF, as one whitespace-normalised string.
 *
 * Text extraction returns positioned fragments rather than lines, so the
 * assertions this feeds are about what the document says, not how it is laid
 * out. The legacy build is the one that runs outside a browser; with no
 * `workerSrc` set, pdf.js falls back to running in this thread.
 */
export async function pdfText(data: Buffer): Promise<string> {
  const task = getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: STANDARD_FONTS,
  });

  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return pages.join(" ").replace(/\s+/g, " ").trim();
  } finally {
    await task.destroy();
  }
}

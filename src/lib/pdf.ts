// Builds a one-page PDF around a JPEG image, without a PDF library.
// The page is `pageWidthPt` wide (A4 = 595.28 pt, 80 mm = 226.77 pt) and as
// tall as the image needs, so a long invoice stays on one page.

const encoder = new TextEncoder();

export const PAGE_WIDTH_PT = { a4: 595.28, thermal: 226.77 } as const;

export function jpegToPdf(jpeg: Uint8Array, widthPx: number, heightPx: number, pageWidthPt: number): Blob {
  const w = pageWidthPt.toFixed(2);
  const h = ((pageWidthPt * heightPx) / widthPx).toFixed(2);

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, write: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    write();
    push("\nendobj\n");
  };

  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

  push("%PDF-1.4\n");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  object(3, () =>
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
    )
  );
  object(4, () => {
    push(
      `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    push(jpeg);
    push("\nendstream");
  });
  object(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));

  const xref = length;
  let table = "xref\n0 6\n0000000000 65535 f \n";
  for (let n = 1; n <= 5; n += 1) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

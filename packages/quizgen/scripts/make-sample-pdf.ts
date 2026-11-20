/** Renders samples/os-notes.md into a multi-page PDF so demos can show a real PDF upload. */
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const md = readFileSync(new URL("../../../samples/os-notes.md", import.meta.url), "utf8");
const doc = await PDFDocument.create();
const body = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

for (const section of md.split(/\n(?=# )/)) {
  const [heading, ...rest] = section.trim().split("\n");
  const page = doc.addPage([595, 842]);
  let y = 780;
  page.drawText(heading!.replace(/^#\s*/, ""), { x: 50, y, size: 20, font: bold, color: rgb(0.1, 0.1, 0.3) });
  y -= 36;
  let line = "";
  const flush = () => {
    page.drawText(line, { x: 50, y, size: 11.5, font: body });
    y -= 17;
    line = "";
  };
  for (const word of rest.join(" ").trim().split(/\s+/)) {
    if (body.widthOfTextAtSize(`${line} ${word}`, 11.5) > 495) flush();
    line = line ? `${line} ${word}` : word;
  }
  if (line) flush();
}
writeFileSync(new URL("../../../samples/os-notes.pdf", import.meta.url), await doc.save());
console.log("wrote samples/os-notes.pdf");

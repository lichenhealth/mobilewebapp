// WORD → LICHEN DOC (founder 2026-11-19: "can you also translate .docx into
// lichen documents?"). A .docx is read in the browser (mammoth, lazy-loaded
// only when one arrives), its headings / lists / tables / bold / links kept,
// every picture stored privately in the member's own Drive storage the way
// Lichen docs hold images, then the whole thing passes sanitizeHtml and
// becomes an ordinary Lichen doc. Old binary .doc files can't be read here.
import { uploadOfficeImage } from './officeMedia';
import { sanitizeHtml, htmlToText } from './richText';
import { createPersonalDoc } from './chatDocsApi';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function isDocx(name: string, mime = ''): boolean {
  return mime === DOCX_MIME || /\.docx$/i.test(name);
}

type MammothImage = { contentType: string; read: (enc: 'base64') => Promise<string> };
type Mammoth = {
  convertToHtml: (input: { arrayBuffer: ArrayBuffer }, opts: unknown) => Promise<{ value: string; messages: { type: string; message: string }[] }>;
  images: { imgElement: (f: (img: MammothImage) => Promise<Record<string, string>>) => unknown };
};

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A Word page's text column is ~6.5in = 624px; a picture's share of it
 *  becomes its width, the way Google Doc imports are sized. */
async function widthPct(blob: Blob): Promise<number> {
  try {
    const bmp = await createImageBitmap(blob);
    const w = bmp.width; bmp.close();
    return Math.max(10, Math.min(100, Math.round((w / 624) * 100)));
  } catch { return 100; }
}

/** Convert a .docx's bytes into Lichen doc HTML (images carried). */
export async function docxToHtml(bytes: ArrayBuffer): Promise<{ html: string; missed: number }> {
  const mod = await import('mammoth/mammoth.browser.js') as unknown as { default?: Mammoth } & Mammoth;
  const mammoth: Mammoth = mod.default ?? mod;
  let missed = 0;
  const res = await mammoth.convertToHtml({ arrayBuffer: bytes }, {
    // Lichen docs: h1 = Title, h2 = Heading, h3 = Subheading.
    styleMap: [
      'p[style-name=\'Title\'] => h1:fresh', 'p[style-name=\'Subtitle\'] => h3:fresh',
      'p[style-name=\'heading 1\'] => h2:fresh', 'p[style-name=\'heading 2\'] => h3:fresh',
      'p[style-name=\'heading 3\'] => h3:fresh', 'p[style-name=\'heading 4\'] => h3:fresh',
    ],
    convertImage: mammoth.images.imgElement(async (img): Promise<Record<string, string>> => {
      try {
        const type = img.contentType || 'image/png';
        const blob = new Blob([b64ToBytes(await img.read('base64'))], { type });
        if (!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(type)) { missed++; return { alt: '' }; }
        const ext = type.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const ref = await uploadOfficeImage(new File([blob], `doc-image.${ext}`, { type }), null);
        return { 'data-store': ref, style: `width: ${await widthPct(blob)}%` };
      } catch { missed++; return { alt: '' }; }
    }),
  });
  // An image mammoth couldn't carry has no ref; sanitizeHtml drops it.
  return { html: sanitizeHtml(res.value || '<p></p>'), missed };
}

/** A whole Word file → a new personal Lichen doc. */
export async function importDocxAsDoc(file: Blob, name: string): Promise<{ id: string; path: string; note?: string }> {
  if (/\.doc$/i.test(name)) throw new Error('Old Word (.doc) files can’t be read here — save it as .docx first.');
  const { html, missed } = await docxToHtml(await file.arrayBuffer());
  const title = name.replace(/\.docx$/i, '').slice(0, 200) || 'Untitled';
  const row = await createPersonalDoc('doc', title, { data: { html } as never, body: htmlToText(html).slice(0, 50000) });
  return {
    id: row.id, path: `/docs/${row.id}`,
    note: missed ? `${missed} picture${missed === 1 ? '' : 's'} couldn’t come over (an unusual image format) — keep the original until you’ve checked` : undefined,
  };
}

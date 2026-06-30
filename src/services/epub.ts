/**
 * EPUB parser.
 *
 * An EPUB is a ZIP archive of XHTML documents plus an OPF manifest. We unzip it
 * in pure JS (JSZip — works in Expo Go, no native module) and walk the OPF
 * spine to get chapters in reading order, then strip each XHTML doc to text.
 *
 * We do NOT use epub.js here. epub.js renders pages inside a WebView, which is
 * great for paginated display but awkward for the plain text our reader, TTS,
 * AI, and FTS pipeline all need. Extracting text directly is simpler and lets
 * the reader render with native <Text> + the user's theme/font settings.
 */
import { File } from "expo-file-system";
import JSZip from "jszip";

import { decodeEntities, htmlToText } from "../utils/html";
import { ParseError, type ParsedBook, type ParsedChapter } from "./parseTypes";

/** Resolve a possibly-relative href against the OPF file's directory. */
function resolvePath(opfDir: string, href: string): string {
  const cleaned = decodeURIComponent(href.replace(/^\.\//, "").split("#")[0]);
  if (!opfDir) return cleaned;
  // Collapse any leading "../" by joining naively — EPUB paths are shallow.
  const parts = `${opfDir}/${cleaned}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m?.[1];
}

export async function parseEpub(fileUri: string): Promise<ParsedBook> {
  const bytes = new File(fileUri).bytesSync();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ParseError("This EPUB file appears to be corrupt or unreadable.");
  }

  // 1. container.xml → path to the OPF package document.
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = containerXml?.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!opfPath) throw new ParseError("EPUB is missing its container manifest.");

  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new ParseError("EPUB package document not found.");
  const opfDir = opfPath.includes("/") ? opfPath.replace(/\/[^/]*$/, "") : "";

  // 2. Metadata.
  const title =
    opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() || "Untitled";
  const author = opf
    .match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1]
    ?.trim();

  // 3. Manifest: id → { href, mediaType, properties }.
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of opf.match(/<item\b[^>]*\/?>/gi) ?? []) {
    const id = attr(item, "id");
    const href = attr(item, "href");
    if (id && href) {
      manifest.set(id, {
        href,
        type: attr(item, "media-type") ?? "",
        props: attr(item, "properties") ?? "",
      });
    }
  }

  // 4. Spine: ordered list of idrefs → reading order. Titles come from the
  // TOC (nav/ncx) when present, else the chapter's first heading.
  const navTitles = await parseNavTitles(zip, opfDir, opf, manifest);
  const chapters: ParsedChapter[] = [];
  for (const ref of opf.match(/<itemref\b[^>]*\/?>/gi) ?? []) {
    const idref = attr(ref, "idref");
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item || !/x?html/i.test(item.type)) continue;

    const path = resolvePath(opfDir, item.href);
    const html = await zip.file(path)?.async("string");
    if (!html) continue;
    const content = htmlToText(html);
    if (content.length === 0) continue;
    const title =
      navTitles.get(path) || firstHeading(html) || `Chapter ${chapters.length + 1}`;
    chapters.push({ title, content });
  }

  if (chapters.length === 0) {
    throw new ParseError("No readable text found in this EPUB.");
  }

  // 5. Cover (best-effort): manifest item flagged cover-image, else any image
  // whose id/href mentions "cover".
  const coverDataUri = await extractCover(zip, opfDir, opf, manifest);

  return { title, author, chapters, format: "epub", coverDataUri };
}

/** First heading (h1–h6) or <title> of an XHTML doc, cleaned. */
function firstHeading(html: string): string | undefined {
  const raw =
    html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return undefined;
  const clean = decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return clean || undefined;
}

/**
 * Build a map of chapter-file path → TOC label, from the EPUB3 nav document or
 * the EPUB2 toc.ncx. hrefs inside the TOC are relative to the TOC file's own
 * directory. First label per file wins (the chapter-level entry).
 */
async function parseNavTitles(
  zip: JSZip,
  opfDir: string,
  opf: string,
  manifest: Map<string, { href: string; type: string; props: string }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const add = (baseDir: string, href: string, label: string) => {
    const text = decodeEntities(label.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) return;
    const path = resolvePath(baseDir, href);
    if (!map.has(path)) map.set(path, text);
  };

  // EPUB3: manifest item with properties="nav".
  let navItem: { href: string } | undefined;
  for (const item of manifest.values()) {
    if (/\bnav\b/i.test(item.props)) {
      navItem = item;
      break;
    }
  }
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href);
    const navDir = navPath.includes("/") ? navPath.replace(/\/[^/]*$/, "") : "";
    const navHtml = await zip.file(navPath)?.async("string");
    if (navHtml) {
      const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(navHtml)) !== null) add(navDir, m[1], m[2]);
    }
  }

  // EPUB2 fallback: toc.ncx (media-type application/x-dtbncx+xml).
  if (map.size === 0) {
    let ncxItem: { href: string } | undefined;
    for (const item of manifest.values()) {
      if (/dtbncx/i.test(item.type)) {
        ncxItem = item;
        break;
      }
    }
    if (ncxItem) {
      const ncxPath = resolvePath(opfDir, ncxItem.href);
      const ncxDir = ncxPath.includes("/") ? ncxPath.replace(/\/[^/]*$/, "") : "";
      const ncx = await zip.file(ncxPath)?.async("string");
      if (ncx) {
        const re =
          /<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content[^>]*src\s*=\s*["']([^"']+)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ncx)) !== null) add(ncxDir, m[2], m[1]);
      }
    }
  }

  return map;
}

async function extractCover(
  zip: JSZip,
  opfDir: string,
  opf: string,
  manifest: Map<string, { href: string; type: string; props: string }>,
): Promise<string | undefined> {
  let coverItem: { href: string; type: string } | undefined;

  // EPUB3: <item properties="cover-image">.
  for (const item of manifest.values()) {
    if (/cover-image/i.test(item.props) && /image\//i.test(item.type)) {
      coverItem = item;
      break;
    }
  }
  // EPUB2: <meta name="cover" content="<manifest-id>">.
  if (!coverItem) {
    const metaId = opf.match(
      /<meta\s+[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    )?.[1];
    const byMeta = metaId ? manifest.get(metaId) : undefined;
    if (byMeta && /image\//i.test(byMeta.type)) coverItem = byMeta;
  }
  // Fallback: any image with "cover" in its href.
  if (!coverItem) {
    for (const item of manifest.values()) {
      if (/image\//i.test(item.type) && /cover/i.test(item.href)) {
        coverItem = item;
        break;
      }
    }
  }
  if (!coverItem) return undefined;

  const file = zip.file(resolvePath(opfDir, coverItem.href));
  if (!file) return undefined;
  try {
    const base64 = await file.async("base64");
    return `data:${coverItem.type};base64,${base64}`;
  } catch {
    return undefined;
  }
}

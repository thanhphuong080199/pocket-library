/**
 * DOCX parser.
 *
 * A .docx is a ZIP whose main body is `word/document.xml` (OOXML). We unzip
 * with JSZip and pull text out of the WordprocessingML run/paragraph elements:
 *   <w:p> … <w:r><w:t>text</w:t></w:r> … </w:p>
 * Each <w:p> is a paragraph; <w:br/> and <w:tab/> are soft breaks.
 *
 * Word has no chapter concept, so we treat the whole document as a single
 * chapter. (Splitting on heading styles is a possible later refinement.)
 */
import { File } from "expo-file-system";
import JSZip from "jszip";

import { decodeEntities } from "../utils/html";
import { ParseError, type ParsedBook } from "./parseTypes";

function docXmlToText(xml: string): string {
  // Paragraph boundaries → double newline.
  let text = xml.replace(/<\/w:p>/gi, "\n\n");
  // In-paragraph breaks/tabs.
  text = text.replace(/<w:br\b[^>]*\/?>/gi, "\n").replace(/<w:tab\b[^>]*\/?>/gi, "\t");
  // Keep only the contents of <w:t> text runs; drop all other tags.
  const runs: string[] = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|(\n)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) runs.push(decodeEntities(m[1]));
    else if (m[2]) runs.push("\n");
  }
  return runs
    .join("")
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseDocx(fileUri: string): Promise<ParsedBook> {
  const bytes = new File(fileUri).bytesSync();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ParseError("This DOCX file appears to be corrupt or unreadable.");
  }

  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new ParseError("DOCX is missing its document body.");

  const text = docXmlToText(xml);
  if (!text) throw new ParseError("No readable text found in this DOCX.");

  // Title from docProps/core.xml if present, else fall back to filename.
  const core = await zip.file("docProps/core.xml")?.async("string");
  const title =
    core?.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() || "";
  const author =
    core?.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1]?.trim();

  const bookTitle = title || "Untitled";
  return {
    title: bookTitle,
    author,
    chapters: [{ title: bookTitle, content: text }],
    format: "docx",
  };
}

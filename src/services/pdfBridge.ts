/**
 * Bridge between the PDF parser (a plain async function) and the hidden
 * WebView that actually runs pdf.js (components/PdfExtractorHost).
 *
 * Why a WebView: extracting text from a PDF needs a real PDF engine. Native
 * options (react-native-pdf) require a Dev Client, which is banned (CLAUDE.md).
 * pdf.js is pure JS but assumes a browser (DOM, Workers, atob), so we host it
 * in a WebView and talk to it over the message bridge.
 *
 * Flow: PdfExtractorHost mounts → loads pdf.js → calls markPdfEngineReady().
 * parsePdf() → extractPdfText(base64) waits for ready, sends the bytes in, and
 * resolves when the host posts back the per-page text (or an error).
 */
export interface PdfResult {
  pages: string[];
  title?: string;
  author?: string;
}

type Pending = { resolve: (r: PdfResult) => void; reject: (e: Error) => void };

let sender: ((base64: string) => void) | null = null;
let pending: Pending | null = null;
let engineReady = false;
let readyWaiters: (() => void)[] = [];

/** Called by the host to register the channel that injects bytes into the WebView. */
export function registerPdfSender(fn: (base64: string) => void): void {
  sender = fn;
}

/** Host signals pdf.js has loaded and is ready to extract. */
export function markPdfEngineReady(): void {
  engineReady = true;
  const waiters = readyWaiters;
  readyWaiters = [];
  waiters.forEach((w) => w());
}

export function deliverPdfResult(result: PdfResult): void {
  pending?.resolve(result);
  pending = null;
}

export function deliverPdfError(message: string): void {
  pending?.reject(new Error(message));
  pending = null;
}

function waitForReady(timeoutMs: number): Promise<void> {
  if (engineReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((w) => w !== onReady);
      reject(
        new Error(
          "The PDF engine didn't load — check your internet connection (pdf.js loads from a CDN on first use).",
        ),
      );
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    readyWaiters.push(onReady);
  });
}

export async function extractPdfText(base64: string): Promise<PdfResult> {
  if (!sender) {
    throw new Error("PDF engine isn't mounted.");
  }
  if (pending) {
    throw new Error("Another PDF is already being processed.");
  }
  await waitForReady(20_000);

  return new Promise<PdfResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      reject(new Error("PDF extraction timed out."));
    }, 120_000);
    pending = {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    };
    sender!(base64);
  });
}

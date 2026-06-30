/**
 * Hidden, always-mounted WebView that runs pdf.js to extract text from PDFs.
 * Mounted once at the app root (app/_layout.tsx). It talks to the rest of the
 * app through services/pdfBridge.ts — see that file for the rationale.
 *
 * pdf.js is loaded from a CDN (UMD v3 build, which keeps the worker setup
 * simple). Extraction therefore needs network on first use; the bridge surfaces
 * a clear error if the engine never becomes ready.
 */
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  deliverPdfError,
  deliverPdfResult,
  markPdfEngineReady,
  registerPdfSender,
} from "@/src/services/pdfBridge";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

// Page that loads pdf.js and waits for base64 bytes posted from RN.
const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<script src="${PDFJS}/pdf.min.js"></script>
<script>
  function post(o){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function boot(){
    if (!window.pdfjsLib) { post({ type: "error", message: "pdf.js failed to load" }); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = "${PDFJS}/pdf.worker.min.js";
    post({ type: "ready" });
  }
  async function extract(base64){
    try {
      var raw = atob(base64);
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      var meta = null;
      try { meta = await pdf.getMetadata(); } catch (e) {}
      var pages = [];
      for (var p = 1; p <= pdf.numPages; p++){
        var page = await pdf.getPage(p);
        var tc = await page.getTextContent();
        var out = "";
        for (var j = 0; j < tc.items.length; j++){
          var it = tc.items[j];
          out += it.str;
          if (it.hasEOL) out += "\\n"; else out += " ";
        }
        pages.push(out);
      }
      post({
        type: "result",
        pages: pages,
        title: meta && meta.info ? meta.info.Title : "",
        author: meta && meta.info ? meta.info.Author : ""
      });
    } catch (e){
      post({ type: "error", message: String((e && e.message) || e) });
    }
  }
  function onMsg(e){ extract(e.data); }
  document.addEventListener("message", onMsg); // Android
  window.addEventListener("message", onMsg);   // iOS
  if (window.pdfjsLib) boot(); else window.addEventListener("load", boot);
</script>
</head><body></body></html>`;

export function PdfExtractorHost() {
  const ref = useRef<WebView>(null);

  useEffect(() => {
    registerPdfSender((base64) => ref.current?.postMessage(base64));
  }, []);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; pages?: string[]; title?: string; author?: string; message?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        markPdfEngineReady();
        break;
      case "result":
        deliverPdfResult({
          pages: msg.pages ?? [],
          title: msg.title || undefined,
          author: msg.author || undefined,
        });
        break;
      case "error":
        deliverPdfError(msg.message || "PDF extraction failed.");
        break;
    }
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html: HTML }}
        originWhitelist={["*"]}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        // pdf.js fetches its worker from the CDN; allow mixed/secure content.
        onError={() => deliverPdfError("PDF engine failed to load.")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Off-screen but still rendered so its JS runs.
  hidden: { position: "absolute", width: 0, height: 0, opacity: 0 },
});

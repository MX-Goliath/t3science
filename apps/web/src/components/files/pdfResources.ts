// Vite emits these alongside the worker so remote clients never need a CDN.
const assets = import.meta.glob<string>(
  [
    "/node_modules/pdfjs-dist/cmaps/*.bcmap",
    "/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
    "/node_modules/pdfjs-dist/wasm/*.{wasm,js}",
  ],
  { eager: true, query: "?url", import: "default" },
);
const urls = new Map(
  Object.entries(assets).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]),
);

export class PdfBinaryDataFactory {
  async fetch({ filename }: { kind: string; filename: string }) {
    const url = urls.get(filename);
    if (!url) throw new Error(`Missing PDF resource: ${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load PDF resource: ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

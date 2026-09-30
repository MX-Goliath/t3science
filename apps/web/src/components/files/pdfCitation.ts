export interface PdfCitation {
  page: number;
  text: string;
  image?: File;
  /** Rectangle in page coordinates, normalized to 0–1. */
  region?: { x: number; y: number; width: number; height: number };
}

export type CitePdf = (citation: PdfCitation) => boolean | Promise<boolean>;

export function formatPdfCitation(source: string, citation: PdfCitation): string {
  const region = citation.region;
  const location = region
    ? `, region ${[region.x, region.y, region.width, region.height].map((n) => `${Math.round(n * 100)}%`).join(", ")} (left, top, width, height)`
    : "";
  const quote = citation.text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\nPDF ${JSON.stringify(source)}, page ${citation.page}${location}:\n${citation.text.trim() ? quote : "See attached page region."}\n\n`;
}

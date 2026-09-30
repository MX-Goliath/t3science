import { lazy, Suspense } from "react";
import type { CitePdf } from "./pdfCitation";

const PdfDocumentPreview = lazy(() => import("./PdfDocumentPreview"));

export const isPdfPreviewFile = (path: string): boolean =>
  /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");

export function BrowserDocumentFrame(props: {
  readonly src: string;
  readonly title: string;
  readonly pdf: boolean;
  readonly onCitePdf?: CitePdf | undefined;
}) {
  const className = "min-h-0 flex-1 border-0 bg-white";
  return props.pdf ? (
    <Suspense fallback={<div className="p-4 text-sm">Loading PDF…</div>}>
      <PdfDocumentPreview
        key={props.src}
        src={props.src}
        title={props.title}
        onCite={props.onCitePdf}
      />
    </Suspense>
  ) : (
    <iframe
      key={props.src}
      src={props.src}
      title={props.title}
      className={className}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
    />
  );
}

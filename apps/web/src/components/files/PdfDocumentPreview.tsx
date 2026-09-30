import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdfTextLayer.css";
import { Button } from "../ui/button";
import { PdfBinaryDataFactory } from "./pdfResources";
import type { CitePdf, PdfCitation } from "./pdfCitation";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfDocumentPreview({
  src,
  title,
  onCite,
}: {
  src: string;
  title: string;
  onCite?: CitePdf | undefined;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setPdf(null);
    setPage(1);
    setError(null);
    const task = getDocument({
      url: src,
      useWorkerFetch: false,
      BinaryDataFactory: PdfBinaryDataFactory,
    });
    void task.promise
      .then((document) => {
        if (!disposed) setPdf(document);
      })
      .catch(() => {
        if (!disposed) setError("Unable to open PDF. It may be password protected or damaged.");
      });
    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [src]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-center gap-2 border-b p-2">
        <Button
          size="xs"
          variant="ghost"
          disabled={!pdf || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous page
        </Button>
        <span className="text-xs" aria-live="polite">
          {pdf ? `Page ${page} of ${pdf.numPages}` : error ? "PDF unavailable" : "Loading PDF…"}
        </span>
        <Button
          size="xs"
          variant="ghost"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          Next page
        </Button>
      </div>
      {error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      ) : pdf ? (
        <PdfPage key={`${src}:${page}`} pdf={pdf} pageNumber={page} title={title} onCite={onCite} />
      ) : null}
    </div>
  );
}

function PdfPage({
  pdf,
  pageNumber,
  title,
  onCite,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  title: string;
  onCite: CitePdf | undefined;
}) {
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(600);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [areaMode, setAreaMode] = useState(false);
  const [region, setRegion] = useState<PdfCitation["region"]>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setWidth(Math.max(100, Math.floor(element.clientWidth - 24))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    let cancel = () => {};
    setReady(false);
    setText("");
    setRegion(undefined);
    setError(null);
    const canvas = canvasRef.current!;
    const container = textRef.current!;
    container.replaceChildren();
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (disposed) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      container.style.setProperty("--scale-round-x", "1px");
      container.style.setProperty("--scale-round-y", "1px");
      container.style.setProperty("--scale-factor", String(viewport.scale));
      container.style.setProperty("--total-scale-factor", String(viewport.scale * page.userUnit));
      const render = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      const layer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });
      cancel = () => {
        render.cancel();
        layer.cancel();
        page.cleanup();
      };
      await Promise.all([render.promise, layer.render()]);
      if (!disposed) setReady(true);
    })().catch(() => {
      if (!disposed) setError("Unable to render this page.");
    });
    return () => {
      disposed = true;
      cancel();
    };
  }, [pdf, pageNumber, width]);
  useEffect(() => {
    const capture = () => {
      const selection = window.getSelection();
      const container = textRef.current;
      setText(
        selection &&
          container?.contains(selection.anchorNode) &&
          container.contains(selection.focusNode)
          ? selection.toString().trim()
          : "",
      );
    };
    document.addEventListener("selectionchange", capture);
    return () => document.removeEventListener("selectionchange", capture);
  }, []);
  const cite = async () => {
    if (!onCite || busy) return;
    setBusy(true);
    setError(null);
    try {
      let image: File | undefined;
      if (region) {
        const source = canvasRef.current!;
        const crop = document.createElement("canvas");
        crop.width = Math.max(1, Math.round(region.width * source.width));
        crop.height = Math.max(1, Math.round(region.height * source.height));
        crop
          .getContext("2d")!
          .drawImage(
            source,
            region.x * source.width,
            region.y * source.height,
            region.width * source.width,
            region.height * source.height,
            0,
            0,
            crop.width,
            crop.height,
          );
        const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not capture region");
        image = new File(
          [blob],
          `${title.replace(/[^a-zA-Z0-9._-]/g, "_")}-page-${pageNumber}.png`,
          { type: "image/png" },
        );
      }
      if (!mountedRef.current) return;
      if (
        await onCite({
          page: pageNumber,
          text: region ? "" : text,
          ...(region ? { region } : {}),
          ...(image ? { image } : {}),
        })
      ) {
        setRegion(undefined);
        window.getSelection()?.removeAllRanges();
        setText("");
      }
    } catch {
      setError("Unable to cite selection. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {onCite ? (
        <div className="flex flex-wrap items-center gap-2 border-b p-2">
          <Button
            size="xs"
            variant={areaMode ? "secondary" : "ghost"}
            aria-pressed={areaMode}
            onClick={() => {
              setAreaMode(!areaMode);
              setRegion(undefined);
              setText("");
              window.getSelection()?.removeAllRanges();
            }}
          >
            Select area
          </Button>
          <Button
            size="xs"
            variant="secondary"
            disabled={!ready || busy || (!region && !text) || text.length > 20000}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void cite()}
          >
            Cite
          </Button>
          <span className="text-xs text-muted-foreground">
            {text.length > 20000
              ? "Shorten selection"
              : areaMode
                ? "Drag over a figure or scanned text."
                : "Select text, then click Cite."}
          </span>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="p-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3">
        <div className="relative w-fit bg-white" aria-label={`${title}, page ${pageNumber}`}>
          <canvas ref={canvasRef} />
          {/* PDF.js supplies the textLayer CSS. */}
          {/* oxlint-disable-next-line shadcn/no-unknown-classes */}
          <div ref={textRef} className="textLayer" />
          {areaMode && ready ? (
            <div
              className="absolute inset-0 touch-none cursor-crosshair"
              onPointerDown={(event) => {
                if (event.button !== 0 || busy) return;
                const rect = event.currentTarget.getBoundingClientRect();
                start.current = {
                  x: (event.clientX - rect.left) / rect.width,
                  y: (event.clientY - rect.top) / rect.height,
                };
                setRegion(undefined);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!start.current) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
                setRegion({
                  x: Math.min(x, start.current.x),
                  y: Math.min(y, start.current.y),
                  width: Math.abs(x - start.current.x),
                  height: Math.abs(y - start.current.y),
                });
              }}
              onPointerUp={() => {
                start.current = null;
                if (region && (region.width * width < 4 || region.height * width < 4))
                  setRegion(undefined);
              }}
              onPointerCancel={() => {
                start.current = null;
                setRegion(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRegion(undefined);
              }}
            >
              {region ? (
                <div
                  className="pointer-events-none absolute border-2 border-primary bg-primary/20"
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

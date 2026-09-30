// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import PdfDocumentPreview from "./PdfDocumentPreview";
import { formatPdfCitation, type PdfCitation } from "./pdfCitation";

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  cancel: vi.fn(),
  getPage: vi.fn(),
}));
vi.mock("./pdfResources", () => ({ PdfBinaryDataFactory: class {} }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 2, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  }),
  TextLayer: class {
    container: HTMLElement;
    constructor({ container }: { container: HTMLElement }) {
      this.container = container;
    }
    render() {
      this.container.textContent = "Selected passage from the PDF.";
      return Promise.resolve();
    }
    cancel() {}
  },
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.getPage.mockReset().mockImplementation(async () => ({
    userUnit: 1,
    cleanup: vi.fn(),
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: mocks.cancel }),
    streamTextContent: () => ({}),
  }));
  mocks.destroy.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function button(label: string) {
  return [...host.querySelectorAll("button")].find((element) => element.textContent === label)!;
}
it("cites selected text with its page and resets selection on page navigation", async () => {
  const onCite = vi.fn((_citation: PdfCitation) => true);
  await act(async () =>
    root.render(<PdfDocumentPreview src="/report.pdf" title="report.pdf" onCite={onCite} />),
  );
  const layer = host.querySelector(".textLayer")!;
  const range = document.createRange();
  range.selectNodeContents(layer);
  await act(() => {
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(button("Cite").disabled).toBe(false);
  await act(async () => button("Cite").click());
  expect(onCite).toHaveBeenCalledWith({ page: 1, text: "Selected passage from the PDF." });
  expect(button("Cite").disabled).toBe(true);
  await act(async () => button("Next page").click());
  expect(mocks.getPage).toHaveBeenLastCalledWith(2);
  expect(host.textContent).toContain("Page 2 of 2");
  expect(button("Next page").disabled).toBe(true);
});
it("ignores text selected outside the PDF", async () => {
  await act(async () =>
    root.render(<PdfDocumentPreview src="/report.pdf" title="report.pdf" onCite={() => true} />),
  );
  const range = document.createRange();
  range.selectNodeContents(button("Next page"));
  await act(() => {
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(button("Cite").disabled).toBe(true);
});
it("keeps selection available if the composer rejects a citation", async () => {
  await act(async () =>
    root.render(<PdfDocumentPreview src="/report.pdf" title="report.pdf" onCite={() => false} />),
  );
  const range = document.createRange();
  range.selectNodeContents(host.querySelector(".textLayer")!);
  await act(() => {
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await act(async () => button("Cite").click());
  expect(button("Cite").disabled).toBe(false);
});
it("reports rendering errors and releases the document on close", async () => {
  mocks.getPage.mockRejectedValue(new Error("damaged"));
  await act(async () => root.render(<PdfDocumentPreview src="/report.pdf" title="report.pdf" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Unable to render this page.");
  await act(() => root.render(null));
  expect(mocks.destroy).toHaveBeenCalledOnce();
});
it("formats document identity, physical page and region for the agent without a signed URL", () => {
  expect(formatPdfCitation("papers/report.pdf", { page: 3, text: "one\ntwo" })).toBe(
    '\nPDF "papers/report.pdf", page 3:\n> one\n> two\n\n',
  );
  expect(
    formatPdfCitation("report.pdf (attachment abc)", {
      page: 2,
      text: "",
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    }),
  ).toContain(
    "page 2, region 10%, 20%, 30%, 40% (left, top, width, height):\nSee attached page region.",
  );
});

it("cites a dragged region as a cropped PNG with page coordinates", async () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(new Blob(["png"], { type: "image/png" })),
  );
  const onCite = vi.fn((_citation: PdfCitation) => true);
  await act(async () =>
    root.render(<PdfDocumentPreview src="/report.pdf" title="report.pdf" onCite={onCite} />),
  );
  await act(() => button("Select area").click());
  const overlay = host.querySelector(".cursor-crosshair") as HTMLDivElement;
  overlay.setPointerCapture = vi.fn();
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 600,
    height: 800,
  } as DOMRect);
  await act(() =>
    overlay.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 60, clientY: 160, button: 0 }),
    ),
  );
  await act(() =>
    overlay.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 240, clientY: 480 }),
    ),
  );
  await act(() => overlay.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
  await act(async () => button("Cite").click());
  const citation = onCite.mock.calls[0]?.[0];
  expect(citation).toMatchObject({
    page: 1,
    text: "",
    region: { x: 0.1, y: 0.2, width: expect.closeTo(0.3), height: expect.closeTo(0.4) },
  });
  expect(citation?.image).toBeInstanceOf(File);
  expect(citation?.image?.type).toBe("image/png");
  expect(drawImage).toHaveBeenCalledOnce();
  expect(button("Cite").disabled).toBe(true);
});

/**
 * MuPDF Engine - Single Channel for MuPDF Usage
 * 
 * This is the ONLY file in the repository allowed to import 'mupdf'.
 * All MuPDF initialization, loading, and low-level operations are centralized here.
 * 
 * Other modules must use functions exported from @/lib/pdf (which internally calls this engine).
 */

// Type declarations for MuPDF module (no type definitions available)
// @ts-ignore - mupdf module exists at runtime but has no type declarations
declare module 'mupdf' {
  export interface MuPDFDocument {
    countPages(): number;
    loadPage(pageIndex: number): MuPDFPage;
  }

  export interface MuPDFPage {
    getCropBox?(): MuPDFRect;
    cropBox?(): MuPDFRect;
    cropbox?(): MuPDFRect;
    getMediaBox?(): MuPDFRect;
    mediaBox?(): MuPDFRect;
    mediabox?(): MuPDFRect;
    getBounds?(): MuPDFRect;
    bound?(): MuPDFRect;
    rect?(): MuPDFRect;
    toPixmap(matrix: any, colorSpace: any, alpha: boolean, showExtras: boolean): MuPDFPixmap;
  }

  export interface MuPDFRect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }

  export interface MuPDFPixmap {
    width?: number | (() => number);
    height?: number | (() => number);
    w?: number | (() => number);
    h?: number | (() => number);
    getWidth?(): number;
    getHeight?(): number;
    getBounds?(): MuPDFRect;
    asPNG(): MuPDFBuffer;
  }

  export interface MuPDFBuffer {
    asUint8Array?(): Uint8Array | Uint8Array;
  }

  export interface MuPDF {
    Document: {
      openDocument(data: Uint8Array, mimeType: string): MuPDFDocument;
    };
    Matrix: {
      scale(x: number, y: number): any;
      translate(x: number, y: number): any;
    };
    ColorSpace: any;
  }

  const mupdf: MuPDF | (() => Promise<MuPDF>) | Promise<MuPDF>;
  export default mupdf;
}

// Lazy-init MuPDF WASM module with memoization
let mupdfPromise: Promise<any> | null = null;
let mupdfUnavailable = false;

/**
 * Load and initialize MuPDF instance.
 * Uses opaque dynamic import to prevent Next.js bundler from rewriting to require().
 * 
 * @returns Initialized MuPDF instance
 * @throws Error if MuPDF module is not available
 */
export async function loadMuPdf(): Promise<any> {
  if (mupdfUnavailable) {
    throw new Error(
      'MuPDF module is not available. Please install it by running: pnpm add mupdf'
    );
  }

  if (!mupdfPromise) {
    mupdfPromise = (async () => {
      try {
        // Opaque import: prevents Next bundler from rewriting to require()
        const importer = new Function('spec', 'return import(spec)');
        // @ts-ignore - mupdf module exists at runtime but has no type declarations
        const mupdfModule = await importer('mupdf');

        // Most WASM bundles export an async init function as default.
        // If default is a function, call it (and await if it's async); otherwise, if it's already an object, use it.
        const init = mupdfModule?.default ?? mupdfModule;

        if (typeof init === 'function') {
          const result = init();
          // Handle both sync and async init functions
          return result instanceof Promise ? await result : result;
        } else {
          return init;
        }
      } catch (error) {
        // Mark MuPDF as unavailable to avoid future import attempts
        mupdfUnavailable = true;
        mupdfPromise = null; // Clear the promise so we don't retry
        throw new Error(
          `Failed to load MuPDF module: ${error instanceof Error ? error.message : String(error)}. ` +
          'Please install it by running: pnpm add mupdf'
        );
      }
    })();
  }

  return mupdfPromise;
}

/**
 * Get MuPDF Document class for opening PDFs.
 */
export async function getMuPdfDocument(): Promise<any> {
  const mupdf = await loadMuPdf();
  const Document = mupdf?.Document;
  if (!Document || typeof Document.openDocument !== 'function') {
    throw new Error('MuPDF Document.openDocument is not available');
  }
  return Document;
}

/**
 * Get MuPDF Matrix class for transformations.
 */
export async function getMuPdfMatrix(): Promise<any> {
  const mupdf = await loadMuPdf();
  const Matrix = mupdf?.Matrix;
  if (!Matrix || typeof Matrix.scale !== 'function') {
    throw new Error('MuPDF Matrix.scale is not available');
  }
  return Matrix;
}

/**
 * Get MuPDF ColorSpace for rendering.
 */
export async function getMuPdfColorSpace(): Promise<any> {
  const mupdf = await loadMuPdf();
  const ColorSpace = mupdf?.ColorSpace;
  if (!ColorSpace) {
    throw new Error('MuPDF ColorSpace is not available');
  }
  return ColorSpace;
}

/**
 * Get MuPDF PDFDocument class for creating new PDFs.
 */
export async function getMuPdfPDFDocument(): Promise<any> {
  const mupdf = await loadMuPdf();
  const PDFDocument = mupdf?.PDFDocument;
  if (!PDFDocument || typeof PDFDocument.create !== "function") {
    throw new Error("MuPDF PDFDocument.create is not available");
  }
  return PDFDocument;
}

/**
 * Extract pixmap dimensions safely, handling various MuPDF API shapes.
 */
export function getPixmapDims(pix: any): { widthPx: number; heightPx: number } {
  const asNum = (v: any) => (typeof v === 'number' ? v : Number(v));

  // Direct numeric properties
  let w = asNum(pix?.width ?? pix?.w);
  let h = asNum(pix?.height ?? pix?.h);

  // Methods
  if (!Number.isFinite(w) && typeof pix?.getWidth === 'function') w = asNum(pix.getWidth());
  if (!Number.isFinite(h) && typeof pix?.getHeight === 'function') h = asNum(pix.getHeight());

  // width()/height() functions
  if (!Number.isFinite(w) && typeof pix?.width === 'function') w = asNum(pix.width());
  if (!Number.isFinite(h) && typeof pix?.height === 'function') h = asNum(pix.height());

  // Bounds fallback
  if ((!Number.isFinite(w) || !Number.isFinite(h)) && typeof pix?.getBounds === 'function') {
    const b = pix.getBounds();
    const x0 = Number(b?.x0 ?? 0);
    const y0 = Number(b?.y0 ?? 0);
    const x1 = Number(b?.x1 ?? 0);
    const y1 = Number(b?.y1 ?? 0);
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (Number.isFinite(bw) && bw > 0) w = bw;
    if (Number.isFinite(bh) && bh > 0) h = bh;
  }

  return { widthPx: w, heightPx: h };
}

/**
 * Extract page bounds from MuPDF page object, handling various API shapes.
 */
export function getPageBounds(pdfPage: any): { x0: number; y0: number; x1: number; y1: number } {
  // Prefer crop box if available (most accurate for visible page)
  let box: any = null;
  if (typeof pdfPage.getCropBox === 'function') {
    box = pdfPage.getCropBox();
  } else if (typeof pdfPage.cropBox === 'function') {
    box = pdfPage.cropBox();
  } else if (typeof pdfPage.cropbox === 'function') {
    box = pdfPage.cropbox();
  }

  // Fallback to media box
  if (!box) {
    if (typeof pdfPage.getMediaBox === 'function') {
      box = pdfPage.getMediaBox();
    } else if (typeof pdfPage.mediaBox === 'function') {
      box = pdfPage.mediaBox();
    } else if (typeof pdfPage.mediabox === 'function') {
      box = pdfPage.mediabox();
    }
  }

  // Last resort: rect/bounds
  if (!box) {
    if (typeof pdfPage.getBounds === 'function') box = pdfPage.getBounds();
    else if (typeof pdfPage.bound === 'function') box = pdfPage.bound();
    else if (typeof pdfPage.rect === 'function') box = pdfPage.rect();
  }

  // Normalize box -> boundsPt
  const x0 = Number(box?.x0 ?? box?.x ?? box?.left ?? 0);
  const y0 = Number(box?.y0 ?? box?.y ?? box?.top ?? 0);
  const x1 = Number(box?.x1 ?? box?.right ?? (box?.w != null ? x0 + Number(box.w) : 0));
  const y1 = Number(box?.y1 ?? box?.bottom ?? (box?.h != null ? y0 + Number(box.h) : 0));

  // Support array form [x0,y0,x1,y1]
  let finalX0 = x0, finalY0 = y0, finalX1 = x1, finalY1 = y1;
  if (Array.isArray(box) && box.length >= 4) {
    finalX0 = Number(box[0]);
    finalY0 = Number(box[1]);
    finalX1 = Number(box[2]);
    finalY1 = Number(box[3]);
  }

  return { x0: finalX0, y0: finalY0, x1: finalX1, y1: finalY1 };
}

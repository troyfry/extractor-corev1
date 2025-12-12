// pdf-parse.d.ts
declare module 'pdf-parse' {
    interface PDFData {
      numpages: number;
      numrender: number;
      info: Record<string, any>;
      metadata: Record<string, any> | null;
      version: string;
      text: string;
    }
    function pdfParse(dataBuffer: Buffer, options?: any): Promise<PDFData>;
    
    const pdfParseDefault: typeof pdfParse;
    export default pdfParseDefault;
  }
  
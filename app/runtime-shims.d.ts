declare module "next" {
  export type Metadata = {
    title?: string;
    description?: string;
    icons?: { icon?: string; shortcut?: string };
  };
}

declare module "next/headers" {
  export function headers(): Promise<{ get(name: string): string | null }>;
}

declare module "next/navigation" {
  export function redirect(path: string): never;
}

declare module "pdfjs-dist/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(options: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
      destroy(): Promise<void>;
    }>;
  };
}

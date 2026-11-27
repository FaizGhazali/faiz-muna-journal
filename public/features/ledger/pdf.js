// Loaded on demand by Ledger's document importers.
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDF_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

export async function openLocalPdf(file, password) {
  const lib = await import(PDFJS);
  lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    password: password || undefined,
    isEvalSupported: false,
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

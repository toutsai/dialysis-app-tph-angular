// Load spreadsheets only when needed, including code pages used by legacy XLS/Big5 files.
let pending: Promise<typeof import('xlsx')> | null = null;

export function loadXlsx(): Promise<typeof import('xlsx')> {
  if (!pending) {
    pending = Promise.all([import('xlsx'), import('xlsx/dist/cpexcel.full.mjs')])
      .then(([xlsx, codepages]) => {
        xlsx.set_cptable(codepages);
        return xlsx;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

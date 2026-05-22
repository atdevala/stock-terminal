import {
  getScannerState,
  scanSymbol,
  triggerScan,
  type ScannerResponse,
  type SymbolScanResponse,
} from "../lib/scanner";

export const scannerService = {
  getState(): ScannerResponse {
    return getScannerState();
  },
  triggerRefresh(): void {
    triggerScan();
  },
  scanSymbol(ticker: unknown): Promise<SymbolScanResponse> {
    return scanSymbol(ticker);
  },
};

import { getScannerState, triggerScan, type ScannerResponse } from "../lib/scanner";

export const scannerService = {
  getState(): ScannerResponse {
    return getScannerState();
  },
  triggerRefresh(): void {
    triggerScan();
  },
};

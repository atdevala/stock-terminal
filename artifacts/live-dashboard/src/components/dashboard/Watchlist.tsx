import { TopBreakoutCandidates } from "./TopBreakoutCandidates";
import { OptionsSetupsToWatch } from "./OptionsSetupsToWatch";

// The "Your List" first page used to be a 150-row category-grouped table with
// its own filter bar and command-center panel. It's replaced entirely by these
// two focused, ranked boxes — the full ranked table still lives on the "Whole
// Market" tab (AlphaScannerPage) for anyone who wants to see everything.
export function Watchlist() {
  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <TopBreakoutCandidates />
      <OptionsSetupsToWatch />
    </div>
  );
}

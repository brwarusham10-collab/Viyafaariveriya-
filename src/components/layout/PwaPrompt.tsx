import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";

/** Asks before activating a new version so a sale in progress is never interrupted by a reload. */
export function PwaPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed bottom-4 end-4 z-50 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-lg" role="status">
      A new version is ready.
      <Button size="sm" onClick={() => updateServiceWorker(true)}>
        Reload
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
    </div>
  );
}

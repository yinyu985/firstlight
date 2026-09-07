import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";

/** This shell is in the initial bundle so a stalled editor download is dismissible. */
export function LoadingDiff({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Snapshot comparison"
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          close.current?.focus();
        }
      }}
    >
      <div className="loading-dialog">
        <span>LOADING DIFF…</span>
        <button ref={close} className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

import "./ui/data-viewer.css";
import { consumeDataBookmark } from "./shared/dataBookmarkStore";

const frame = document.querySelector<HTMLIFrameElement>("#data-bookmark-frame");
const status = document.querySelector<HTMLElement>("#data-bookmark-status");
if (!frame || !status) throw new Error("Data bookmark viewer markup is incomplete.");
const viewerFrame = frame;
const viewerStatus = status;

function showError(message: string): void {
  viewerStatus.hidden = false;
  viewerStatus.textContent = message;
  viewerStatus.dataset.state = "error";
}

async function loadDataBookmark(): Promise<void> {
  if (window.self !== window.top) throw new Error("Open this bookmark directly in its own tab.");
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) throw new Error("This data bookmark link is incomplete.");
  let dataUrl: string | null = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    dataUrl = await consumeDataBookmark(id);
    if (dataUrl) break;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  if (!dataUrl?.toLowerCase().startsWith("data:")) {
    throw new Error("The data bookmark could not be loaded. Open it again from Firstlight.");
  }

  const timeout = window.setTimeout(() => {
    window.removeEventListener("message", receiveMessage);
    showError("The data bookmark did not start. Open it again from Firstlight.");
  }, 10_000);
  function receiveMessage(event: MessageEvent<unknown>): void {
    if (event.source !== viewerFrame.contentWindow || !event.data || typeof event.data !== "object") return;
    const message = event.data as { type?: string; message?: string };
    if (message.type === "FIRSTLIGHT_DATA_READY") {
      viewerFrame.contentWindow?.postMessage({ type: "FIRSTLIGHT_OPEN_DATA", url: dataUrl }, "*");
    } else if (message.type === "FIRSTLIGHT_DATA_OPENED" || message.type === "FIRSTLIGHT_DATA_ERROR") {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receiveMessage);
      if (message.type === "FIRSTLIGHT_DATA_ERROR") showError(message.message ?? "Unable to open the data bookmark.");
      else viewerStatus.hidden = true;
    }
  }
  window.addEventListener("message", receiveMessage);
  // A network document supplies its own CSP, inside an opaque-origin sandbox.
  // Bookmark scripts cannot read Firstlight's tokens or application data.
  viewerFrame.src = "./data-renderer.html";
}

void loadDataBookmark().catch((error: unknown) => showError(error instanceof Error ? error.message : "Unable to open the data bookmark."));

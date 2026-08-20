import "./ui/data-viewer.css";
import { consumeDataBookmark } from "./shared/dataBookmarkStore";

const frame = document.querySelector<HTMLIFrameElement>("#data-bookmark-frame");
const status = document.querySelector<HTMLElement>("#data-bookmark-status");

if (!frame || !status) throw new Error("Data bookmark viewer markup is incomplete.");
const viewerFrame = frame;
const viewerStatus = status;

const launcherDocument = `<!doctype html><meta charset="utf-8"><script>
addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "FIRSTLIGHT_OPEN_DATA" || typeof event.data.url !== "string") return;
  try {
    const response = await fetch(event.data.url);
    const blobUrl = URL.createObjectURL(await response.blob());
    top.location.href = blobUrl;
  } catch (error) {
    parent.postMessage({ type: "FIRSTLIGHT_DATA_ERROR", message: error instanceof Error ? error.message : "Unable to decode data URL" }, "*");
  }
});
parent.postMessage({ type: "FIRSTLIGHT_DATA_READY" }, "*");
</script>`;
const launcherUrl = `data:text/html;charset=utf-8,${encodeURIComponent(launcherDocument)}`;

function launchDataBookmark(url: string): void {
  const receiveMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== viewerFrame.contentWindow || !event.data || typeof event.data !== "object") return;
    const message = event.data as { type?: unknown; message?: unknown };
    if (message.type === "FIRSTLIGHT_DATA_READY") {
      viewerFrame.contentWindow?.postMessage({ type: "FIRSTLIGHT_OPEN_DATA", url }, "*");
    } else if (message.type === "FIRSTLIGHT_DATA_ERROR") {
      viewerStatus.textContent = typeof message.message === "string" ? message.message : "Unable to render the data bookmark.";
      viewerStatus.dataset.state = "error";
      window.removeEventListener("message", receiveMessage);
    }
  };
  window.addEventListener("message", receiveMessage);
  viewerFrame.src = launcherUrl;
}

async function loadDataBookmark(): Promise<void> {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) throw new Error("This data bookmark link is incomplete.");

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const url = await consumeDataBookmark(id);
    if (url) {
      if (!url.toLowerCase().startsWith("data:")) throw new Error("The staged bookmark is not a data URL.");
      launchDataBookmark(url);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  throw new Error("The data bookmark could not be loaded. Open it again from Firstlight.");
}

void loadDataBookmark().catch((error: unknown) => {
  viewerStatus.textContent = error instanceof Error ? error.message : "The data bookmark could not be loaded.";
  viewerStatus.dataset.state = "error";
});

if (window.origin !== "null" || parent === window) throw new Error("The bookmark launcher requires an opaque-origin sandbox.");
let opened = false;
addEventListener("message", async (event: MessageEvent<unknown>) => {
  if (opened || event.source !== parent || !event.data || typeof event.data !== "object") return;
  const message = event.data as { type?: string; url?: string };
  if (message.type !== "FIRSTLIGHT_OPEN_DATA" || typeof message.url !== "string" || !message.url.toLowerCase().startsWith("data:")) return;
  opened = true;
  try {
    const response = await fetch(message.url);
    const url = URL.createObjectURL(await response.blob());
    top!.location.replace(url);
    parent.postMessage({ type: "FIRSTLIGHT_DATA_OPENED" }, "*");
  } catch (error) {
    parent.postMessage({ type: "FIRSTLIGHT_DATA_ERROR", message: error instanceof Error ? error.message : "Unable to decode data URL" }, "*");
  }
});
parent.postMessage({ type: "FIRSTLIGHT_DATA_READY" }, "*");

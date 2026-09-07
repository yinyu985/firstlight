import React from "react";
import { createRoot } from "react-dom/client";
import { ExtensionApp } from "./ui/ExtensionApp";
import { OnlineApp } from "./ui/OnlineApp";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  window.self !== window.top ? (
    <p>Open Firstlight directly in its own tab.</p>
  ) : (
    <React.StrictMode>
      <ErrorBoundary name="Firstlight">{__FIRSTLIGHT_TARGET__ === "extension" ? <ExtensionApp /> : <OnlineApp />}</ErrorBoundary>
    </React.StrictMode>
  )
);

import React from "react";
import { createRoot } from "react-dom/client";
import { ExtensionApp } from "./ui/ExtensionApp";
import { OnlineApp } from "./ui/OnlineApp";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {__FIRSTLIGHT_TARGET__ === "extension" ? <ExtensionApp /> : <OnlineApp />}
  </React.StrictMode>
);

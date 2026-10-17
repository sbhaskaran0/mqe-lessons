import "katex/dist/katex.min.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyTheme, progress } from "./progress";

// Apply the saved theme before the first paint, so a dark-mode reader never sees a light flash.
applyTheme(progress.settings().theme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

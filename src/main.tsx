import { createRoot } from "react-dom/client";
import GardaApp from "./App";
import "./styles.css";
import { registerPushWorker } from "./PushSettings";

const root = document.getElementById("root");
if (!root) throw new Error("Elementul principal al aplicației lipsește.");
createRoot(root).render(<GardaApp />);
if ("serviceWorker" in navigator && window.isSecureContext) void registerPushWorker().catch(() => {});

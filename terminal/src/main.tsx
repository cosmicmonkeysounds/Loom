import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "@fontsource/vt323";
import "./styles.css";

const el = document.getElementById("root");
if (el) createRoot(el).render(<App />);

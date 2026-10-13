import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { MapApp } from "./map/MapApp.tsx";
import "@fontsource/vt323";
import "./styles.css";

/** `/reinstall/map` is the house map; everything else is the game. */
const isMap = /\/map\/?$/.test(window.location.pathname);

const el = document.getElementById("root");
if (el) {
  document.title = isMap ? "House map" : "Reinstallation";
  createRoot(el).render(isMap ? <MapApp /> : <App />);
}

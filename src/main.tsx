import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import "./styles/surfaces.css";
import "./styles/settings.css";
import "./styles/workspace-modules.css";
import "./styles/rounded.css";
import "./styles/menu-theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);

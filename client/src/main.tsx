import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { LanguageProvider } from "./i18n";
import { initApiBaseFetch } from "./lib/api-base";
import App from "./App";
import "./index.css";

initApiBaseFetch();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </ThemeProvider>
);

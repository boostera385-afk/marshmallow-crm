import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "./components/theme-provider";
import { MotionConfig } from "framer-motion";
import { AuthProvider } from "@/contexts/AuthContext";
import { installStaleChunkReloadHandler } from "@/lib/lazyWithReload";
import { installOverloadGuard } from "@/lib/overload-guard";

// Recover automatically when a post-deploy stale chunk fails to preload.
installStaleChunkReloadHandler();
// Pause background refreshes (never user actions) while the server is overloaded.
installOverloadGuard();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <App />
      </AuthProvider>
    </MotionConfig>
  </ThemeProvider>,
);

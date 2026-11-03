import { DemoCards } from "../components/DemoCards";
import { Hero } from "../components/Hero";
import { HighlightsStrip } from "../components/HighlightsStrip";
import { CallProvider } from "../lib/CallContext";
import { turnstileSiteKey } from "../lib/turnstileConfig";

// Static: the Turnstile keys are read at build time. Vercel env changes need a redeploy anyway.
export default function HomePage() {
  return (
    <main style={{ padding: "0 24px 72px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column" }}>
        <CallProvider>
          <Hero turnstileSiteKey={turnstileSiteKey()} />
          <HighlightsStrip />
          <DemoCards />
        </CallProvider>
      </div>
    </main>
  );
}

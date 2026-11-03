import { Playground } from "../../components/Playground";
import { CallProvider } from "../../lib/CallContext";

export const metadata = {
  title: "Agent playground · Eashan Kadam",
  description: "Pick a voice agent, rewrite its system prompt, then call it.",
};

export default function PlaygroundPage() {
  return (
    <main style={{ padding: "0 24px 72px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <CallProvider floatingTranscript={false}>
          <Playground />
        </CallProvider>
      </div>
    </main>
  );
}

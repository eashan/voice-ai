"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AgentAvailability } from "../app/api/status/route";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { useVoiceCall, type SessionAuth, type StartResult, type VoiceCall } from "./useVoiceCall";

/** Which UI started the current/last call: "concierge" or a demo agentId. */
export type CallOwner = string;

interface CallContextValue {
  call: VoiceCall;
  owner: CallOwner | null;
  /** A call is connecting or live for this owner. */
  isActive: (owner: CallOwner) => boolean;
  /** Any call is connecting or live. */
  busy: boolean;
  startCall: (owner: CallOwner, auth: SessionAuth) => Promise<StartResult>;
  stopCall: () => void;
  availability: { public: AgentAvailability; invited: AgentAvailability };
  /** The browser holds the invite cookie (demos unlocked). */
  unlocked: boolean;
  unlock: (code: string) => Promise<{ ok: boolean; error?: string }>;
  markUnlocked: () => void;
}

const Ctx = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCall must be used inside <CallProvider>");
  return v;
}

/**
 * One voice call per page: the hero and every demo card share it, so only one can be live at a time.
 * Also owns availability (which pre-warms the Fly machine), the unlock state and the floating transcript.
 */
export function CallProvider({
  children,
  floatingTranscript = true,
}: {
  children: React.ReactNode;
  /** The playground shows its transcript in the page instead. */
  floatingTranscript?: boolean;
}) {
  const call = useVoiceCall();
  const [owner, setOwner] = useState<CallOwner | null>(null);
  const [availability, setAvailability] = useState<CallContextValue["availability"]>({
    public: "unknown",
    invited: "unknown",
  });
  const [unlocked, setUnlocked] = useState(false);
  const wasActive = useRef(false);

  const refreshStatus = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json() as Promise<{ status: AgentAvailability; invited?: AgentAvailability }>)
      .then((b) => setAvailability({ public: b.status, invited: b.invited ?? "unknown" }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    fetch("/api/unlock")
      .then((r) => r.json() as Promise<{ unlocked?: boolean }>)
      .then((b) => setUnlocked(b.unlocked === true))
      .catch(() => {});
  }, [refreshStatus]);

  // Refresh availability after each call ends (slots and minutes changed).
  useEffect(() => {
    const active = call.status !== "idle";
    if (wasActive.current && !active) refreshStatus();
    wasActive.current = active;
  }, [call.status, refreshStatus]);

  const busy = call.status !== "idle";

  const startCall = useCallback(
    async (who: CallOwner, auth: SessionAuth) => {
      setOwner(who);
      const res = await call.start(auth);
      // A successful start with the invite code also set the unlock cookie.
      if (res.ok && auth.code) setUnlocked(true);
      return res;
    },
    [call],
  );

  const unlock = useCallback(async (code: string) => {
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json()) as { unlocked?: boolean; error?: string };
      if (res.ok && body.unlocked) {
        setUnlocked(true);
        return { ok: true };
      }
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    } catch {
      return { ok: false, error: "Couldn't reach the server. Try again." };
    }
  }, []);

  const value: CallContextValue = {
    call,
    owner,
    isActive: (who) => busy && owner === who,
    busy,
    startCall,
    stopCall: call.stop,
    availability,
    unlocked,
    unlock,
    markUnlocked: () => setUnlocked(true),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {floatingTranscript && <TranscriptPanel status={call.status} turns={call.turns} />}
    </Ctx.Provider>
  );
}

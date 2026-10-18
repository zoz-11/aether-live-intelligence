import { useCallback, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { sendTurn } from "@/lib/aether/session";
import { createRecognizer, speechSupported } from "@/lib/aether/speech";
import { useAether } from "@/lib/aether/store";
import { cn } from "@/lib/utils";
import { SmartCards } from "./cards";

export function LiveStage() {
  const live = useAether((s) => s.live);
  const setLive = useAether((s) => s.setLive);
  const messages = useAether((s) => s.conversations.find((c) => c.id === s.activeConversationId)?.messages ?? []);
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  const transcriptRef = useRef("");
  const recRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const supported = speechSupported();

  const stopListen = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    const text = transcriptRef.current.trim();
    transcriptRef.current = "";
    setLive({ listening: false, active: false, interim: "" });
    if (text) void sendTurn(text);
  }, [setLive]);

  const startListen = useCallback(() => {
    transcriptRef.current = "";
    setLive({ active: true, listening: true, interim: "" });
    const rec = createRecognizer({
      onInterim: (t) => setLive({ interim: `${transcriptRef.current} ${t}`.trim() }),
      onFinalChunk: (t) => {
        transcriptRef.current = `${transcriptRef.current} ${t}`.trim();
        setLive({ interim: transcriptRef.current });
      },
      onEnd: () => setLive({ listening: false }),
    });
    recRef.current = rec;
    try {
      rec?.start();
    } catch {
      setLive({ listening: false, active: false });
    }
  }, [setLive]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-8">
      <button
        type="button"
        aria-label={live.listening ? "Release to send" : "Hold to talk"}
        className={cn(
          "orb size-28 rounded-full transition active:scale-95 md:size-36",
          live.listening && "orb-listen",
          live.thinking && "opacity-80",
        )}
        onPointerDown={(e) => {
          e.preventDefault();
          if (!supported) return;
          startListen();
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          if (live.listening) stopListen();
        }}
        onPointerLeave={() => {
          if (live.listening) stopListen();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <p className="mt-6 max-w-md text-center font-medium tracking-tight text-fg">
        {live.thinking
          ? "Thinking…"
          : live.interim || last?.content || (supported ? "Hold to talk · release to send" : "Speech not supported — type below")}
      </p>
      <SmartCards cards={last?.cards} className="mt-4 w-full max-w-md" />
      {!supported && (
        <p className="mt-3 text-center text-xs text-muted">Use Chrome/Safari for Voice-Lock, or type.</p>
      )}
    </div>
  );
}

export function Composer() {
  const [value, setValue] = useState("");
  const thinking = useAether((s) => s.live.thinking);
  const requestLook = useAether((s) => s.requestLook);
  const screenOn = useAether((s) => s.plugins.some((p) => p.id === "screen" && p.enabled));

  return (
    <form
      className="flex items-center gap-2 border-t border-border bg-bg/90 p-3 backdrop-blur"
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim();
        if (!t || thinking) return;
        setValue("");
        void sendTurn(t);
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask Aether"
        className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 text-base text-fg outline-none placeholder:text-muted"
      />
      {screenOn && (
        <button
          type="button"
          className="rounded-full bg-surface-2 px-3 py-2 text-xs text-fg"
          onClick={() => {
            requestLook();
            void sendTurn("What's on my screen?");
          }}
        >
          Look
        </button>
      )}
      <button
        type="submit"
        disabled={thinking || !value.trim()}
        className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40"
      >
        Send
      </button>
    </form>
  );
}

export function Transcript() {
  const messages = useAether((s) => s.conversations.find((c) => c.id === s.activeConversationId)?.messages ?? []);
  const newConv = useAether((s) => s.newConversation);
  if (!messages.length) return null;
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-surface/50 md:flex">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium">Conversation</p>
        <button type="button" className="text-xs text-muted" onClick={() => newConv()}>
          New
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4">
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <p className="text-[10px] uppercase tracking-wide text-subtle">{m.role === "user" ? "You" : "Aether"}</p>
            <p className="mt-1 leading-relaxed text-muted">{m.content}</p>
            <SmartCards cards={m.cards} />
          </div>
        ))}
      </div>
    </aside>
  );
}

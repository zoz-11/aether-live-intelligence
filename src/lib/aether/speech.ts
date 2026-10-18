type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function ctor(): (new () => Rec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Rec;
    webkitSpeechRecognition?: new () => Rec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported() {
  return !!ctor();
}

/** Voice-Lock: accumulate finals while held; caller sends only on release. */
export function createRecognizer(handlers: {
  onInterim: (t: string) => void;
  onFinalChunk: (t: string) => void;
  onEnd: () => void;
}): Rec | null {
  const C = ctor();
  if (!C) return null;
  const rec = new C();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  rec.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const row = ev.results[i];
      const text = row[0]?.transcript ?? "";
      if (row.isFinal) handlers.onFinalChunk(text);
      else interim += text;
    }
    if (interim) handlers.onInterim(interim);
  };
  rec.onend = () => handlers.onEnd();
  rec.onerror = () => handlers.onEnd();
  return rec;
}

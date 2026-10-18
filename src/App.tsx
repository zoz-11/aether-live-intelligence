import { Composer, LiveStage, Transcript } from "@/components/aether/live";
import { SettingsPanel } from "@/components/aether/settings";
import { useAether } from "@/lib/aether/store";

export function App() {
  const openApp = useAether((s) => s.openApp);
  const setOpenApp = useAether((s) => s.setOpenApp);
  const device = useAether((s) => s.device);
  const notes = useAether((s) => s.notes);

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-5xl flex-col bg-bg text-fg md:flex-row"
      style={{ filter: `brightness(${Math.max(0.4, device.brightness)})` }}
    >
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Aether</h1>
            <p className="text-xs text-subtle">
              {device.flashlight ? "Flashlight on · " : ""}
              {device.dnd ? "DND · " : ""}
              Voice-Lock · unified memory
            </p>
          </div>
          <nav className="flex gap-1">
            {(
              [
                ["home", "Live"],
                ["notes", "Notes"],
                ["settings", "Settings"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs ${openApp === id ? "bg-accent text-accent-fg" : "text-muted"}`}
                onClick={() => setOpenApp(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        <main className="relative min-h-0 flex-1 overflow-auto">
          {openApp === "home" && <LiveStage />}
          {openApp === "settings" && <SettingsPanel />}
          {openApp === "notes" && (
            <ul className="space-y-3 p-4">
              {notes.map((n) => (
                <li key={n.id} className="rounded-2xl border border-border bg-surface p-4">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-1 text-sm text-muted">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </main>

        {openApp === "home" && <Composer />}
      </div>
      <Transcript />
    </div>
  );
}

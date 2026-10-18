import { useAether } from "@/lib/aether/store";

export function SettingsPanel() {
  const plugins = useAether((s) => s.plugins);
  const togglePlugin = useAether((s) => s.togglePlugin);
  const customInstructions = useAether((s) => s.customInstructions);
  const setCustomInstructions = useAether((s) => s.setCustomInstructions);
  const memory = useAether((s) => s.memory);
  const removeMemory = useAether((s) => s.removeMemory);
  const device = useAether((s) => s.device);
  const patchDevice = useAether((s) => s.patchDevice);

  return (
    <div className="space-y-6 p-4">
      <section>
        <h2 className="text-sm font-medium text-fg">Custom instructions</h2>
        <textarea
          className="mt-2 w-full rounded-xl border border-border bg-surface p-3 text-sm text-fg outline-none"
          rows={3}
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="How Aether should behave…"
        />
      </section>

      <section>
        <h2 className="text-sm font-medium text-fg">Plugins</h2>
        <ul className="mt-2 space-y-2">
          {plugins.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 rounded-xl bg-surface px-3 py-2">
              <div>
                <p className="text-sm text-fg">{p.name}</p>
                <p className="text-xs text-subtle">{p.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={p.enabled}
                className={`h-7 w-12 shrink-0 rounded-full ${p.enabled ? "bg-ok" : "bg-surface-2"}`}
                onClick={() => togglePlugin(p.id)}
              >
                <span
                  className={`block size-5 translate-y-1 rounded-full bg-white transition ${p.enabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-fg">Memory</h2>
        {memory.length === 0 ? (
          <p className="mt-2 text-xs text-subtle">Empty. Say “remember …” with Memory on.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {memory.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-sm">
                <span className="text-muted">{m.fact}</span>
                <button type="button" className="text-xs text-subtle" onClick={() => removeMemory(m.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-fg">Device (simulated)</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full bg-surface-2 px-3 py-1.5 text-xs"
            onClick={() => patchDevice({ flashlight: !device.flashlight })}
          >
            Flashlight {device.flashlight ? "on" : "off"}
          </button>
          <button
            type="button"
            className="rounded-full bg-surface-2 px-3 py-1.5 text-xs"
            onClick={() => patchDevice({ dnd: !device.dnd })}
          >
            DND {device.dnd ? "on" : "off"}
          </button>
        </div>
      </section>
    </div>
  );
}

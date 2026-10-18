import { handleConfirmAction, sendTurn } from "@/lib/aether/session";
import type { UiCard } from "@/lib/aether/types";
import { cn } from "@/lib/utils";

export function SmartCards({ cards, className }: { cards?: UiCard[]; className?: string }) {
  if (!cards?.length) return null;
  return (
    <div className={cn("mt-2 space-y-2", className)}>
      {cards.map((card) => (
        <article
          key={card.id}
          className="rounded-2xl border border-border bg-surface px-4 py-3 text-left"
          data-card-kind={card.kind}
        >
          {card.title && <p className="text-sm font-medium text-fg">{card.title}</p>}
          {card.body && <p className={cn("text-sm text-muted", card.title && "mt-1")}>{card.body}</p>}
          {card.kind === "list" && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted">
              {(card.items ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {card.kind === "kv" && (
            <dl className="mt-2 space-y-1 text-sm">
              {(card.fields ?? []).map((f) => (
                <div key={f.label} className="flex justify-between gap-3">
                  <dt className="text-subtle">{f.label}</dt>
                  <dd className="text-fg">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {(card.kind === "actions" || card.kind === "confirm") && (
            <div className="mt-3 flex flex-wrap gap-2">
              {(card.actions ?? []).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium",
                    a.confirmAction === "confirm"
                      ? "bg-accent text-accent-fg"
                      : a.confirmAction === "cancel"
                        ? "bg-surface-2 text-muted"
                        : "bg-surface-2 text-fg",
                  )}
                  onClick={() => {
                    if (a.confirmAction) handleConfirmAction(a.confirmAction);
                    else if (a.prompt) void sendTurn(a.prompt);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

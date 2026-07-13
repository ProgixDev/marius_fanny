import { useEffect, useState, useCallback } from "react";
import { normalizedApiUrl } from "../lib/AuthClient";
import { authHeaders } from "../utils/authHeaders";
import { Check, Lock, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

interface ClosingItem {
  key: string;
  label: string;
  checked: boolean;
  checkedAt?: string;
}
interface ClosingSection {
  title: string;
  items: ClosingItem[];
}
interface Closing {
  date: string;
  sections: ClosingSection[];
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
}

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Montreal" });
}
function shiftDate(d: string, days: number): string {
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split("T")[0];
}
function frDate(d: string): string {
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("fr-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function Fermeture() {
  const TODAY = todayISO();
  const [date, setDate] = useState<string>(TODAY);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [exists, setExists] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [initials, setInitials] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const isToday = date === TODAY;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = isToday
        ? `${normalizedApiUrl}/api/closing/today`
        : `${normalizedApiUrl}/api/closing/history?date=${date}`;
      const r = await fetch(url, { headers: authHeaders(), credentials: "include" });
      const j = await r.json();
      setClosing(j.data || null);
      setExists(j.exists !== false && !!j.data);
    } catch {
      setError("Impossible de charger la fermeture.");
    } finally {
      setLoading(false);
    }
  }, [date, isToday]);

  useEffect(() => {
    load();
  }, [load]);

  const locked = !isToday || !!closing?.completed;

  const toggle = async (key: string, checked: boolean) => {
    if (locked || busy) return;
    // Optimiste
    setClosing((prev) =>
      prev
        ? {
            ...prev,
            sections: prev.sections.map((s) => ({
              ...s,
              items: s.items.map((it) => (it.key === key ? { ...it, checked } : it)),
            })),
          }
        : prev,
    );
    try {
      const r = await fetch(`${normalizedApiUrl}/api/closing/today/item`, {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ key, checked }),
      });
      const j = await r.json();
      if (j.success) setClosing(j.data);
      else load();
    } catch {
      load();
    }
  };

  const total = closing?.sections.reduce((n, s) => n + s.items.length, 0) || 0;
  const done =
    closing?.sections.reduce((n, s) => n + s.items.filter((i) => i.checked).length, 0) || 0;
  const allChecked = total > 0 && done === total;
  const canComplete = isToday && !closing?.completed && allChecked && initials.trim().length > 0;

  const complete = async () => {
    if (!canComplete || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${normalizedApiUrl}/api/closing/today/complete`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ initials: initials.trim() }),
      });
      const j = await r.json();
      if (j.success) {
        setClosing(j.data);
      } else {
        setError(j.error || "Impossible de terminer la fermeture.");
      }
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6">
      {/* Barre de date */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <button
          onClick={() => setDate((d) => shiftDate(d, -1))}
          className="p-2 rounded-lg hover:bg-stone-100 text-stone-600"
          aria-label="Jour précédent"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-center">
          <CalendarDays className="w-5 h-5 text-[#C5A065]" />
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-400">Fermeture</p>
            <p className="font-semibold text-stone-800 capitalize">{frDate(date)}</p>
          </div>
        </div>
        <button
          onClick={() => setDate((d) => shiftDate(d, 1))}
          disabled={date >= TODAY}
          className="p-2 rounded-lg hover:bg-stone-100 text-stone-600 disabled:opacity-30"
          aria-label="Jour suivant"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      {!isToday && (
        <button
          onClick={() => setDate(TODAY)}
          className="text-xs text-[#337957] font-semibold mb-3 underline"
        >
          Revenir à aujourd'hui
        </button>
      )}

      {loading ? (
        <p className="text-center text-stone-400 py-10">Chargement…</p>
      ) : !exists && !isToday ? (
        <div className="text-center py-10 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="font-semibold text-amber-800">Aucune fermeture enregistrée ce jour-là.</p>
        </div>
      ) : (
        <>
          {closing?.completed && (
            <div className="mb-4 flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
              <Lock className="w-5 h-5 text-green-700 shrink-0" />
              <p className="text-sm text-green-800">
                Fermeture <strong>terminée</strong> par{" "}
                <strong className="uppercase">{closing.completedBy}</strong>
                {closing.completedAt &&
                  " le " +
                    new Date(closing.completedAt).toLocaleString("fr-CA", {
                      timeZone: "America/Montreal",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                .
              </p>
            </div>
          )}

          {/* Progression */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-stone-500 mb-1">
              <span>Progression</span>
              <span>
                {done} / {total}
              </span>
            </div>
            <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#337957] transition-all"
                style={{ width: `${total ? (done / total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-5">
            {closing?.sections.map((section) => (
              <div key={section.title}>
                <h3 className="font-bold text-stone-800 mb-2">{section.title}</h3>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => toggle(item.key, !item.checked)}
                      disabled={locked}
                      className={`w-full flex items-start gap-3 text-left p-2.5 rounded-lg transition-colors ${
                        locked ? "cursor-default" : "hover:bg-stone-50"
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          item.checked
                            ? "bg-[#337957] border-[#337957] text-white"
                            : "border-stone-300 text-transparent"
                        }`}
                      >
                        <Check className="w-4 h-4" strokeWidth={3} />
                      </span>
                      <span
                        className={`text-sm ${
                          item.checked ? "text-stone-400 line-through" : "text-stone-700"
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Zone de validation (seulement aujourd'hui, non terminé) */}
          {isToday && !closing?.completed && (
            <div className="mt-6 border-t border-stone-200 pt-5">
              <label className="block text-sm font-semibold text-stone-700 mb-2">
                Initiales <span className="text-red-500">*</span>{" "}
                <span className="font-normal text-stone-400">(obligatoire)</span>
              </label>
              <input
                value={initials}
                onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 5))}
                maxLength={5}
                placeholder="MF"
                className="w-24 h-12 text-center uppercase font-bold text-lg tracking-widest border-2 border-stone-300 rounded-md focus:border-[#337957] focus:ring-1 focus:ring-[#337957] mb-4"
              />
              {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
              {!allChecked && (
                <p className="text-sm text-amber-600 mb-3">
                  ⚠️ Toutes les tâches doivent être cochées avant de terminer.
                </p>
              )}
              <button
                onClick={complete}
                disabled={!canComplete || busy}
                className="w-full py-3 rounded-xl font-bold text-white transition-colors bg-[#337957] hover:bg-[#2a6448] disabled:bg-stone-300 disabled:cursor-not-allowed"
              >
                {busy ? "Enregistrement…" : "Terminer la fermeture"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

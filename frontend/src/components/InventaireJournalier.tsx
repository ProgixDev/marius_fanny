import { useState, useEffect, useCallback } from "react";
import {
  CalendarDays,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Info,
  Trash2,
  Plus,
  Printer
} from "lucide-react";
import {
  dailyInventoryAPI,
  type DailyInventoryEntry,
} from "../lib/DailyInventoryAPI";

// ─── LISTE DES PRODUITS PAR DÉFAUT ──────────────────────────────────────────

const PRODUITS_PAR_DEFAUT = [
  "Croissant", "Chocolatine", "Danoise framboises", "Danoise aux raisins",
  "Chausson aux pommes", "Abricotine", "Palmier", "Frangipane",
  "Croissant amandes", "Chocolatine aux amandes", "Croissant pistache", "Brioche aux sucres",
  "Danoise cannelle", "Biscuit choco", "Croissant aux fromages", "Brioche suisse",
  "Quiche jambon et fromage", "Qui. jambon grand", "Quiche épinard et fromage",
  "Qui. épinard grand", "Quiche poireaux fromage de chèvre", "Qui. poireaux grand",
  "Tropezienne", "Tropezienne fraise", "Tourte provençal", "Tourte gibier",
  "Pizza", "Quiche saumon gr", "Quiche aux deux saumons", "Pâté au poulet",
  "Pâté poulet grand", "Pâté au saumon", "Pâté saumon grand",
  "Tourtière", "Tourtière grand", "Croque monsieur", "Croque végé",
  "Plat cuisiné", "Soupe 1Litre", "Soupe", "SUPPLÉMENT :"
];

// Maps the OLD inventory row names to their exact catalog names, so an
// existing saved list (in localStorage or the MongoDB sentinel) is upgraded
// automatically on load — no manual re-typing, and custom additions / "grand"
// rows are preserved untouched.
const RENAME_MAP: Record<string, string> = {
  "Danoise framboise": "Danoise framboises",
  "Brioche raisin": "Danoise aux raisins",
  "Chausson pomme": "Chausson aux pommes",
  "Bande frangipane": "Frangipane",
  "Choco amandes": "Chocolatine aux amandes",
  "Crois Pistache": "Croissant pistache",
  "Brioche sucre": "Brioche aux sucres",
  "Brioche cannelle": "Danoise cannelle",
  "Crois fromage": "Croissant aux fromages",
  "Suisse": "Brioche suisse",
  "Qui. jambon petit": "Quiche jambon et fromage",
  "Qui. épinard petit": "Quiche épinard et fromage",
  "Qui. poireaux petit": "Quiche poireaux fromage de chèvre",
  "Quiche saum petit": "Quiche aux deux saumons",
  "Pâté poulet petit": "Pâté au poulet",
  "Pâté saumon petit": "Pâté au saumon",
  "Tourtière petit": "Tourtière",
};

function migrateNames(list: string[]): string[] {
  return list.map((n) => RENAME_MAP[n] || n);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function calcTotal(e: RowState): number {
  // Total = stdo + client only (addition entre Comm. St-do et Comm CLIENT)
  // Les autres colonnes (stock_stdo, berri, comm_berri) sont stockées mais pas incluses dans le total
  const stdo = typeof e.stdo === "number" ? e.stdo : 0;
  const client = typeof e.client === "number" ? e.client : 0;
  return stdo + client;
}

// ─── types ──────────────────────────────────────────────────────────────────

interface RowState {
  productId: string;
  productName: string;
  stock_stdo: number; // <-- Nouvelle colonne ST-do ajoutée
  stdo: number;
  berri: number;
  comm_berri: number;
  client: number;
}

function hasInventoryValue(entry?: Partial<DailyInventoryEntry> | null): boolean {
  if (!entry) return false;
  return (
    (entry.stock_stdo ?? 0) > 0 ||
    (entry.stdo ?? 0) > 0 ||
    (entry.berri ?? 0) > 0 ||
    (entry.comm_berri ?? 0) > 0 ||
    (entry.client ?? 0) > 0
  );
}

type Col = "stock_stdo" | "stdo" | "berri" | "comm_berri" | "client";

const COLUMNS: { key: Col; label: string; sublabel: string }[] = [
  {
    key: "stock_stdo", label: "ST-do",
    sublabel: ""
  },
  {
    key: "stdo", label: "Comm. St-do",
    sublabel: ""
  },
  {
    key: "berri", label: "BERRI",
    sublabel: ""
  },
  {
    key: "comm_berri", label: "Comm Berri",
    sublabel: ""
  },
  {
    key: "client", label: "Comm CLIENT",
    sublabel: ""
  },
];

// ─── component ──────────────────────────────────────────────────────────────

export default function InventaireJournalier() {
  const gold = "#C5A065";

  // ── state ──
  const [date, setDate] = useState<string>(todayISO());
  const [rows, setRows] = useState<RowState[]>([]);
  
  // Gestion de la liste personnalisée de produits
  const [customProducts, setCustomProducts] = useState<string[]>(() => {
    const saved = localStorage.getItem("inventaire_produits_personnalises");
    return migrateNames(saved ? JSON.parse(saved) : PRODUITS_PAR_DEFAUT);
  });
  const [newProductName, setNewProductName] = useState("");

  // Clé sentinelle dans MongoDB pour persister la liste cross-appareils
  const PRODUCTS_SENTINEL_KEY = "__products_config_daily";

  // Charger la liste depuis le backend au démarrage
  useEffect(() => {
    const loadProductsFromBackend = async () => {
      try {
        const res = await dailyInventoryAPI.getByDate(PRODUCTS_SENTINEL_KEY);
        if (res.data.entries && res.data.entries.length > 0) {
          const rawNames = res.data.entries.map((e) => e.productName);
          const names = migrateNames(rawNames);
          setCustomProducts(names);
          localStorage.setItem("inventaire_produits_personnalises", JSON.stringify(names));
          // If a rename actually happened, persist it back so the upgrade sticks
          // server-side (and across devices) instead of re-migrating every load.
          if (JSON.stringify(names) !== JSON.stringify(rawNames)) {
            saveProductsToBackend(names);
          }
        }
      } catch {
        // Pas encore de liste sauvegardée côté backend — utiliser localStorage/défauts
      }
    };
    loadProductsFromBackend();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sauvegarder la liste de produits dans le backend
  const saveProductsToBackend = (list: string[]) => {
    dailyInventoryAPI.save({
      date: PRODUCTS_SENTINEL_KEY,
      entries: list.map((name) => ({
        productId: name,
        productName: name,
        stock_stdo: 0,
        stdo: 0,
        berri: 0,
        comm_berri: 0,
        client: 0,
        total: 0,
      })),
    }).catch(() => {/* ignorer les erreurs réseau */});
  };

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [savedBy, setSavedBy] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // ── auto-dismiss toast ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Ajouter ou supprimer un produit de la liste ──
  const handleAddProduct = () => {
    const name = newProductName.trim();
    if (!name) return;
    if (customProducts.includes(name)) {
      setToast({ type: "error", msg: "Ce produit existe déjà dans la liste." });
      return;
    }
    const updatedList = [...customProducts, name];
    setCustomProducts(updatedList);
    localStorage.setItem("inventaire_produits_personnalises", JSON.stringify(updatedList));
    saveProductsToBackend(updatedList);
    setNewProductName("");
    setToast({ type: "success", msg: `Produit "${name}" ajouté et sauvegardé.` });
  };

  const handleRemoveProduct = (name: string) => {
    if (window.confirm(`Êtes-vous sûr de vouloir retirer "${name}" de la liste ?\n\nCette action supprime le produit de l'inventaire pour tous les utilisateurs, jusqu'à ce qu'il soit rajouté.`)) {
      const updatedList = customProducts.filter((p) => p !== name);
      setCustomProducts(updatedList);
      localStorage.setItem("inventaire_produits_personnalises", JSON.stringify(updatedList));
      saveProductsToBackend(updatedList);
      setToast({ type: "success", msg: `Produit "${name}" retiré.` });
    }
  };

  // ── build / reload rows whenever date or products change ──
  const loadInventory = useCallback(async () => {
    if (!customProducts.length) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await dailyInventoryAPI.getByDate(date);

      // Live "Comm CLIENT" quantities recomputed from current orders, so
      // deleted/cancelled orders leave no phantom numbers. If the recompute is
      // unavailable (offline / 401), fall back to the stored client value.
      let computedClient: Record<string, number> | null = null;
      try {
        const computed = await dailyInventoryAPI.getComputedClient(date);
        computedClient = computed?.data?.journalier ?? null;
      } catch {
        computedClient = null;
      }
      const clientFor = (name: string, stored: number) =>
        computedClient ? (computedClient[name] ?? 0) : stored;

      const existingMap = new Map<string, DailyInventoryEntry>(
        res.data.entries.map((e) => [e.productId, e]),
      );

      const built: RowState[] = customProducts.map((name) => {
        // On utilise le nom comme ID unique
        const saved = existingMap.get(name);
        return {
          productId: name,
          productName: name,
          stock_stdo: saved?.stock_stdo ?? 0, // <-- Intégration de la nouvelle valeur
          stdo:       saved?.stdo       ?? 0,
          berri:      saved?.berri      ?? 0,
          comm_berri: saved?.comm_berri ?? 0,
          client:     clientFor(name, saved?.client ?? 0),
        };
      });

      const historicalRows: RowState[] = res.data.entries
        .filter((entry) => !customProducts.includes(entry.productId) && hasInventoryValue(entry))
        .map((entry) => ({
          productId: entry.productId,
          productName: entry.productName,
          stock_stdo: entry.stock_stdo ?? 0,
          stdo: entry.stdo ?? 0,
          berri: entry.berri ?? 0,
          comm_berri: entry.comm_berri ?? 0,
          client: clientFor(entry.productName, entry.client ?? 0),
        }));

      const mergedRows = [...built, ...historicalRows];

      setRows(sortAsc ? mergedRows : [...mergedRows].reverse());
      setLastSaved(res.data.updatedAt);
      setSavedBy(res.data.savedBy);
    } catch {
      setToast({ type: "error", msg: "Erreur lors du chargement de l'inventaire." });
    } finally {
      setLoading(false);
    }
  }, [date, customProducts, sortAsc]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  // ── cell change handler ──
  const handleCellChange = (productId: string, col: Col, raw: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.productId !== productId) return r;
        const isSupplement = (r.productName || "").toLowerCase().includes("suppl");
        const val: any = isSupplement
          ? raw // keep as string for SUPPLÉMENT
          : raw === "" ? 0 : Math.max(0, parseInt(raw, 10) || 0);
        return { ...r, [col]: val };
      }),
    );
  };

  // ── save ──
  const handleSave = async () => {
    setSaving(true);
    try {
      const entries: DailyInventoryEntry[] = rows.map((r) => ({
        productId:   r.productId,
        productName: r.productName,
        stock_stdo:  r.stock_stdo, // <-- Sauvegarde de la nouvelle colonne
        stdo:        r.stdo,
        berri:       r.berri,
        comm_berri:  r.comm_berri,
        client:      r.client,
        total:       calcTotal(r),
      }));

      const res = await dailyInventoryAPI.save({ date, entries });
      setLastSaved(res.data.updatedAt);
      setSavedBy(res.data.savedBy);
      setToast({ type: "success", msg: res.message ?? "Inventaire sauvegardé." });
    } catch (err: any) {
      setToast({ type: "error", msg: err?.message ?? "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  };

  // ── column totals (exclude SUPPLÉMENT row which is text, not numeric) ──
  const numericRows = rows.filter(
    (r) => !(r.productName || "").toLowerCase().includes("suppl"),
  );
  const colTotals = COLUMNS.reduce<Record<Col, number>>(
    (acc, c) => {
      acc[c.key] = numericRows.reduce(
        (s, r) => s + (typeof r[c.key] === "number" ? r[c.key] : 0),
        0,
      );
      return acc;
    },
    { stock_stdo: 0, stdo: 0, berri: 0, comm_berri: 0, client: 0 },
  );
  const grandTotal = COLUMNS.reduce((s, c) => s + colTotals[c.key], 0);

  const displayDate = new Date(date + "T00:00:00").toLocaleDateString("fr-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full p-4 md:p-8">
      {/* ── Header ── */}
      <header className="mb-6">
        <h2
          className="text-4xl md:text-5xl mb-1"
          style={{ fontFamily: '"Great Vibes", cursive', color: gold }}
        >
          Inventaire Journalier
        </h2>
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
          Gestion quotidienne des stocks
        </p>
      </header>

      {/* ── Control bar ── */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3 bg-white/80 backdrop-blur-md border border-stone-200 rounded-2xl px-4 py-3 shadow-sm">
          <CalendarDays size={20} style={{ color: gold }} />
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-stone-400 block">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm font-semibold text-stone-800 bg-transparent outline-none cursor-pointer"
            />
          </div>
        </div>

        <button
          onClick={loadInventory}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-3 bg-white/80 backdrop-blur-md border border-stone-200 rounded-2xl text-stone-600 hover:text-[#C5A065] hover:border-[#C5A065] shadow-sm transition-all disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          <span className="text-sm font-medium hidden sm:inline">Recharger</span>
        </button>

        <button
          onClick={() => {
            const printContent = document.getElementById("inventaire-journalier-table");
            if (!printContent) return;
            const win = window.open("", "_blank");
            if (!win) return;
            win.document.write(`
              <html><head><title>Inventaire Journalier — ${date}</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { font-size: 18px; margin-bottom: 4px; }
                p { color: #666; font-size: 12px; margin-bottom: 16px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ddd; padding: 6px 10px; font-size: 12px; text-align: center; }
                th { background: #f5f5f5; font-weight: bold; }
                td:first-child, th:first-child { text-align: left; }
                @media print { body { padding: 0; } }
              </style></head><body>
              <h1>Inventaire Journalier</h1>
              <p>${new Date(date + "T00:00:00").toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
              ${printContent.outerHTML}
              </body></html>
            `);
            win.document.close();
            win.print();
          }}
          disabled={!rows.length}
          className="flex items-center gap-2 px-4 py-3 rounded-2xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          <Printer size={18} />
          <span className="text-sm font-medium hidden sm:inline">Imprimer</span>
        </button>

        <button
          onClick={handleSave}
          disabled={saving || loading || !rows.length}
          className="ml-auto flex items-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold shadow-lg hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          style={{ background: `linear-gradient(135deg, ${gold}, #b8935a)` }}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          <span>{saving ? "Sauvegarde…" : "Sauvegarder"}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm font-semibold text-stone-600 capitalize">{displayDate}</p>
        {lastSaved && (
          <div className="flex items-center gap-1.5 text-xs text-stone-400">
            <Info size={13} />
            <span>
              Dernière sauvegarde : {new Date(lastSaved).toLocaleString("fr-CA")}
              {savedBy ? ` — par ${savedBy}` : ""}
            </span>
          </div>
        )}
      </div>

      {toast && (
        <div
          className={`flex items-center gap-3 px-5 py-3 mb-5 rounded-2xl text-sm font-medium shadow-lg animate-fade-in
            ${toast.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"}`}
        >
          {toast.type === "success" ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0" /> : <XCircle size={18} className="text-red-500 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* ── Summary cards ── */}
      {/* Changement de grid-cols-5 à grid-cols-6 pour accueillir la nouvelle colonne proprement */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        {COLUMNS.map((col) => (
          <SummaryCard key={col.key} label={col.label} sub={col.sublabel} value={colTotals[col.key]} gold={gold} />
        ))}
        <SummaryCard label="TOTAL GÉNÉRAL" sub="tous canaux" value={grandTotal} gold={gold} highlight />
      </div>

      {/* ── Table ── */}
      <div className="bg-white/80 backdrop-blur-md rounded-3xl shadow-xl border border-white overflow-hidden">
        
        {/* Table header & Add Product */}
        <div className="flex flex-col md:flex-row items-center justify-between px-6 py-4 border-b border-stone-100 gap-4">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} style={{ color: gold }} />
            <span className="font-bold text-stone-800 text-sm">
              {rows.length} produit{rows.length !== 1 ? "s" : ""} dans la liste
            </span>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <input
              type="text"
              placeholder="Nouveau produit..."
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProduct()}
              className="px-3 py-1.5 text-sm rounded-xl border border-stone-200 focus:outline-none focus:border-[#C5A065] w-full md:w-48"
            />
            <button
              onClick={handleAddProduct}
              className="p-1.5 rounded-xl text-white hover:opacity-90 transition-opacity flex-shrink-0"
              style={{ background: gold }}
              title="Ajouter à la liste"
            >
              <Plus size={18} />
            </button>
          </div>

          <button
            onClick={() => setSortAsc((v) => !v)}
            className="flex items-center gap-1 text-xs text-stone-400 hover:text-[#C5A065] transition-colors"
          >
            {sortAsc ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {sortAsc ? "Ordre normal" : "Ordre inversé"}
          </button>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-3 text-stone-400">
              <Loader2 size={22} className="animate-spin" style={{ color: gold }} />
              <span className="text-sm">Chargement...</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-stone-400">
              <ClipboardList size={40} className="opacity-30" />
              <p className="text-sm">Aucun produit dans la liste.</p>
            </div>
          ) : (
            <table id="inventaire-journalier-table" className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-stone-400 w-64">
                    Produit
                  </th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} className="px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-stone-400">
                      <div>{col.label}</div>
                      <div className="text-[8px] font-normal text-stone-300 mt-0.5 normal-case tracking-normal">{col.sublabel}</div>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-stone-400 min-w-[80px]">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-stone-50">
                {rows.map((row, idx) => {
                  const isSupplementRow = (row.productName || "").toLowerCase().includes("suppl");
                  const total = isSupplementRow ? 0 : calcTotal(row);
                  return (
                    <tr key={row.productId} className={`group transition-colors hover:bg-amber-50/30 ${idx % 2 === 0 ? "bg-white" : "bg-stone-50/40"}`}>
                      <td className="px-5 py-2.5 font-medium text-stone-800">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: gold }}>
                            {idx + 1}
                          </span>
                          <span className="truncate">{row.productName}</span>
                          <button
                            onClick={() => handleRemoveProduct(row.productId)}
                            className="text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            title="Retirer de la liste"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>

                      {COLUMNS.map((col) => {
                        const isSupplement = (row.productName || "").toLowerCase().includes("suppl");
                        return (
                          <td key={col.key} className="px-2 py-2">
                            {isSupplement ? (
                              <input
                                type="text"
                                value={row[col.key] === 0 ? "" : row[col.key]}
                                placeholder="..."
                                onChange={(e) => handleCellChange(row.productId, col.key, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                className="w-full text-center px-2 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800 font-semibold focus:outline-none focus:border-[#C5A065] focus:ring-2 focus:ring-[#C5A065]/20 hover:border-stone-300 transition-colors text-sm"
                              />
                            ) : (
                              <input
                                type="number"
                                min={0}
                                value={row[col.key] === 0 ? "" : row[col.key]}
                                placeholder="0"
                                onChange={(e) => handleCellChange(row.productId, col.key, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                className="w-full text-center px-2 py-1.5 rounded-xl border border-stone-200 bg-white text-stone-800 font-semibold focus:outline-none focus:border-[#C5A065] focus:ring-2 focus:ring-[#C5A065]/20 hover:border-stone-300 transition-colors text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            )}
                          </td>
                        );
                      })}

                      <td className="px-3 py-2 text-center">
                        {isSupplementRow ? (
                          <span className="text-stone-300">—</span>
                        ) : (
                          <span className={`inline-block min-w-[52px] px-3 py-1.5 rounded-xl font-bold text-sm ${total > 0 ? "text-white shadow-sm" : "text-stone-300 bg-stone-100"}`} style={total > 0 ? { background: gold } : undefined}>
                            {total}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-stone-200 bg-stone-50">
                  <td className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-stone-500">Totaux</td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="px-2 py-3 text-center">
                      <span className="font-bold text-stone-700">{colTotals[col.key]}</span>
                    </td>
                  ))}
                  <td className="px-3 py-3 text-center">
                    <span className="inline-block min-w-[52px] px-3 py-1.5 rounded-xl font-black text-sm text-white shadow" style={{ background: gold }}>
                      {grandTotal}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}

interface SummaryCardProps { label: string; sub: string; value: number; gold: string; highlight?: boolean; }
function SummaryCard({ label, sub, value, gold, highlight = false }: SummaryCardProps) {
  return (
    <div className={`rounded-2xl p-4 border shadow-sm transition-all hover:shadow-md ${highlight ? "text-white border-transparent shadow-lg" : "bg-white/70 backdrop-blur-md border-white text-stone-800"}`} style={highlight ? { background: `linear-gradient(135deg, ${gold}, #b8935a)` } : undefined}>
      <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${highlight ? "text-white/70" : "text-stone-400"}`}>{label}</p>
      <p className={`text-2xl font-bold ${highlight ? "text-white" : "text-stone-800"}`}>{value}</p>
      <p className={`text-[10px] mt-1 ${highlight ? "text-white/60" : "text-stone-400"}`}>{sub}</p>
    </div>
  );
}
import { useState, useEffect, useCallback } from "react";
import {
  CalendarDays,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ClipboardList,
  Info,
  Plus,
  Trash2,
  Pencil,
  Printer
} from "lucide-react";
import { dailyInventoryAPI } from "../lib/DailyInventoryAPI";

// ─── LISTE DES PRODUITS DE LA FEUILLE FOUR ──────────────────────────────────
const PRODUITS_FOUR_DEFAUT = [
  "Éclair chantilly", "Éclair chocolat", "Éclair pistache", "Mille-feuilles",
  "Tartelette aux fraise", "Tartelette fruits", "Crème brulée", "Tarte aux fraises",
  "Tarte aux fruits", "Tropézienne", "Tropézienne fraises", "Mini pâtisserie",
];

// Upgrades an existing saved list (localStorage / MongoDB sentinel) to the
// exact catalog names automatically on load — no manual re-typing, custom
// additions preserved. Keep in sync with FOUR_PRODUCTS in the backend
// inventoryBuckets.ts.
const RENAME_MAP: Record<string, string> = {
  "Millefeuille": "Mille-feuilles",
  "Tartelette fraise": "Tartelette aux fraise",
  "Tarte fraise": "Tarte aux fraises",
  "Tarte fruits": "Tarte aux fruits",
  // Nom abrégé qui ne correspondait pas au produit réel → ne comptait pas dans
  // Frais (corrigé le 9 juillet 2026).
  "Trop. fraise": "Tropézienne fraises",
};

function migrateNames(list: string[]): string[] {
  return list.map((n) => RENAME_MAP[n] || n);
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function numOf(v: any): number {
  return typeof v === "number" ? v : 0;
}

function hasInventoryValue(entry?: any): boolean {
  if (!entry) return false;
  return (
    (entry.stock_stdo ?? 0) > 0 ||
    (entry.stdo ?? 0) > 0 ||
    (entry.berri ?? 0) > 0 ||
    (entry.comm_berri ?? 0) > 0 ||
    (entry.client ?? 0) > 0
  );
}

export default function InventaireFour() {
  const gold = "#C5A065";
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Gestion de la liste locale pour le Four
  const [products, setProducts] = useState<string[]>(() => {
    const saved = localStorage.getItem("produits_inventaire_four");
    return migrateNames(saved ? JSON.parse(saved) : PRODUITS_FOUR_DEFAUT);
  });
  const [newProd, setNewProd] = useState("");

  // Clé sentinelle MongoDB pour persister la liste cross-appareils
  const PRODUCTS_SENTINEL_KEY = "__products_config_four";

  // Charger la liste depuis le backend au démarrage
  useEffect(() => {
    const loadProductsFromBackend = async () => {
      try {
        const res = await dailyInventoryAPI.getByDate(PRODUCTS_SENTINEL_KEY);
        if (res.data.entries && res.data.entries.length > 0) {
          const rawNames = res.data.entries.map((e: any) => e.productName);
          const names = migrateNames(rawNames);
          setProducts(names);
          localStorage.setItem("produits_inventaire_four", JSON.stringify(names));
          // Persist the rename back so the upgrade sticks server-side.
          if (JSON.stringify(names) !== JSON.stringify(rawNames)) {
            saveProductsToBackend(names);
          }
        }
      } catch {
        // Pas encore sauvegardé côté backend — utiliser localStorage/défauts
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
    }).catch(() => {});
  };

  // Renommer un produit de la liste (comme dans l'inventaire journalier).
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const handleRenameProduct = (oldName: string, rawNewName: string) => {
    const newName = rawNewName.trim();
    setEditingProductId(null);
    if (!newName || newName === oldName) return;
    if (!products.includes(oldName)) {
      setToast({ type: "error", msg: "Cette ligne (historique) ne peut pas être renommée." });
      return;
    }
    if (products.includes(newName)) {
      setToast({ type: "error", msg: "Ce nom existe déjà dans la liste." });
      return;
    }
    const updatedList = products.map((p) => (p === oldName ? newName : p));
    setProducts(updatedList);
    localStorage.setItem("produits_inventaire_four", JSON.stringify(updatedList));
    saveProductsToBackend(updatedList);
    setToast({ type: "success", msg: `Renommé en "${newName}" et sauvegardé.` });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // On utilise un préfixe "four_" pour différencier les données en base de données
      const res = await dailyInventoryAPI.getByDate(`${date}__four`);

      // Live "Comm CLIENT" quantities recomputed from current orders (frais
      // bucket), so deleted/cancelled orders leave no phantom numbers. Falls
      // back to the stored value if the recompute is unavailable.
      let computedClient: Record<string, number> | null = null;
      try {
        const computed = await dailyInventoryAPI.getComputedClient(date);
        computedClient = computed?.data?.four ?? null;
      } catch {
        computedClient = null;
      }
      // Comm CLIENT = part AUTO (commandes frais) + AJOUT MANUEL de Fanny.
      // Hors ligne (recompute indispo), on reconstitue l'auto depuis le dernier
      // enregistrement (client - clientManual) pour ne pas perdre l'ajout manuel.
      const resolveClient = (name: string, saved?: any) => {
        const manual = numOf(saved?.clientManual);
        const clientAuto = computedClient
          ? (computedClient[name] ?? 0)
          : numOf(saved?.client) - manual;
        return { clientAuto, client: Math.max(0, clientAuto + manual) };
      };

      const map = new Map(res.data.entries.map((e: any) => [e.productId, e]));

      const built = products.map(name => {
        const s = map.get(name);
        const { clientAuto, client } = resolveClient(name, s);
        return {
          id: name,
          name: name,
          stock_stdo: s?.stock_stdo ?? 0,
          stdo: s?.stdo ?? 0,
          berri: s?.berri ?? 0,
          comm_berri: s?.comm_berri ?? 0,
          client,
          clientAuto,
        };
      });

      const historicalRows = res.data.entries
        .filter((entry: any) => !products.includes(entry.productId) && hasInventoryValue(entry))
        .map((entry: any) => {
          const { clientAuto, client } = resolveClient(entry.productName, entry);
          return {
            id: entry.productId,
            name: entry.productName,
            stock_stdo: entry.stock_stdo ?? 0,
            stdo: entry.stdo ?? 0,
            berri: entry.berri ?? 0,
            comm_berri: entry.comm_berri ?? 0,
            client,
            clientAuto,
          };
        });

      setRows([...built, ...historicalRows]);
    } catch {
      setToast({ type: "error", msg: "Erreur de chargement" });
    } finally { setLoading(false); }
  }, [date, products]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const entries = rows.map(r => ({
        productId: r.id,
        productName: r.name,
        stock_stdo: r.stock_stdo,
        stdo: r.stdo,
        berri: r.berri,
        comm_berri: r.comm_berri,
        client: r.client,
        // Ajout manuel (delta) = total affiché − part auto, conservé entre les chargements.
        clientManual: numOf(r.client) - numOf(r.clientAuto),
        total: r.stdo + r.comm_berri + r.client // Comm. St-do + Comm Berri + Comm CLIENT
      }));
      await dailyInventoryAPI.save({ date: `${date}__four`, entries });
      setToast({ type: "success", msg: "Production four enregistrée !" });
    } catch {
      setToast({ type: "error", msg: "Erreur sauvegarde" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-4 md:p-8">
      <header className="mb-6">
        <h2 className="text-4xl md:text-5xl mb-1" style={{ fontFamily: '"Great Vibes", cursive', color: gold }}>
          Inventaire Frais
        </h2>
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">Registre de production quotidienne</p>
      </header>

      {/* Barre de contrôle */}
      <div className="flex flex-wrap items-center gap-4 mb-6 bg-white p-4 rounded-2xl shadow-sm border border-stone-100">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} style={{ color: gold }} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="font-bold text-stone-800 outline-none" />
        </div>
        
        <div className="flex items-center gap-2 ml-auto">
          <input 
            type="text" 
            placeholder="Ajouter pâtisserie..." 
            value={newProd}
            onChange={(e) => setNewProd(e.target.value)}
            className="border rounded-xl px-3 py-2 text-sm outline-none focus:border-[#C5A065]"
          />
          <button 
            onClick={() => {
              if(!newProd.trim()) return;
              const up = [...products, newProd.trim()];
              setProducts(up);
              localStorage.setItem("produits_inventaire_four", JSON.stringify(up));
              saveProductsToBackend(up);
              setNewProd("");
            }}
            className="p-2 rounded-xl text-white" style={{ background: gold }}
          ><Plus size={20}/></button>
        </div>

        <button
          onClick={() => {
            const win = window.open("", "_blank");
            if (!win) return;
            // Tableau propre généré depuis les données (sans icônes ni champs),
            // compact et en paysage pour tenir sur une seule page.
            const fmtDate = new Date(date + "T00:00:00").toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            const cols = [
              { key: "stock_stdo", label: "ST-do" },
              { key: "stdo", label: "Comm. St-do" },
              { key: "berri", label: "BERRI" },
              { key: "comm_berri", label: "Comm Berri" },
              { key: "client", label: "Comm CLIENT" },
            ];
            const n = (v: any) => (typeof v === "number" ? v : 0);
            const heads = cols.map((c) => `<th>${c.label}</th>`).join("");
            const body = rows.map((r, idx) => {
              const cells = cols.map((c) => {
                const v = r[c.key];
                return `<td>${typeof v === "number" ? (v === 0 ? "" : v) : (v || "")}</td>`;
              }).join("");
              const total = n(r.stdo) + n(r.comm_berri) + n(r.client);
              return `<tr><td class="prod">${idx + 1}. ${r.name}</td>${cells}<td>${total || ""}</td></tr>`;
            }).join("");
            const footCells = cols.map((c) => {
              const sum = rows.reduce((s, r) => s + n(r[c.key]), 0);
              return `<td>${sum || ""}</td>`;
            }).join("");
            const grand = rows.reduce((s, r) => s + n(r.stdo) + n(r.comm_berri) + n(r.client), 0);
            win.document.write(`
              <html><head><title>Inventaire Frais — ${date}</title>
              <style>
                @page { size: A4 landscape; margin: 8mm; }
                body { font-family: Arial, sans-serif; }
                h1 { font-size: 15px; margin: 0 0 2px; }
                p { color: #666; font-size: 11px; margin: 0 0 8px; text-transform: capitalize; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ccc; padding: 2px 4px; font-size: 10px; text-align: center; }
                th { background: #f0f0f0; }
                td.prod, th.prod { text-align: left; width: 26%; }
                tfoot td { font-weight: bold; background: #f7f7f7; }
              </style></head><body>
              <h1>Inventaire Frais</h1>
              <p>${fmtDate}</p>
              <table>
                <thead><tr><th class="prod">Pâtisserie</th>${heads}<th>Total</th></tr></thead>
                <tbody>${body}</tbody>
                <tfoot><tr><td class="prod">Totaux</td>${footCells}<td>${grand || ""}</td></tr></tfoot>
              </table>
              </body></html>
            `);
            win.document.close();
            win.print();
          }}
          disabled={!rows.length}
          className="px-4 py-2 rounded-xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Printer size={18}/>
          <span className="hidden sm:inline">Imprimer</span>
        </button>

        <button onClick={handleSave} disabled={saving} className="px-6 py-2 rounded-xl text-white font-bold flex items-center gap-2" style={{ background: gold }}>
          {saving ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>}
          Sauvegarder
        </button>
      </div>

      {/* Tableau simplifié pour le Four */}
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-stone-100">
        <table id="inventaire-frais-table" className="w-full text-left">
          <thead className="bg-stone-50 border-b">
            <tr className="text-[10px] uppercase tracking-widest text-stone-400">
              <th className="px-6 py-4">Pâtisserie</th>
              <th className="text-center">ST-do</th>
              <th className="text-center">Comm. St-do</th>
              <th className="text-center">BERRI</th>
              <th className="text-center">Comm Berri</th>
              <th className="text-center">Comm CLIENT</th>
              <th className="text-center">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {rows.map((row, idx) => (
              <tr key={row.id} className="hover:bg-amber-50/20 transition-colors">
                <td className="px-6 py-3 font-medium text-stone-800">
                  <div className="flex items-center justify-between gap-2">
                    {editingProductId === row.id ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={row.name}
                        onBlur={(e) => handleRenameProduct(row.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingProductId(null);
                        }}
                        className="flex-1 min-w-0 px-2 py-1 text-sm rounded-lg border border-[#C5A065] focus:outline-none focus:ring-2 focus:ring-[#C5A065]/20"
                      />
                    ) : (
                      <>
                        <span className="truncate">{row.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setEditingProductId(row.id)}
                            className="text-stone-300 hover:text-[#C5A065]"
                            title="Renommer (pour matcher le nom du site)"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Retirer "${row.name}" de la liste pour tous les utilisateurs ?`)) {
                                const up = products.filter(p => p !== row.id);
                                setProducts(up);
                                localStorage.setItem("produits_inventaire_four", JSON.stringify(up));
                                saveProductsToBackend(up);
                              }
                            }}
                            className="text-stone-300 hover:text-red-500"
                            title="Retirer de la liste"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-2 py-2 text-center">
                  <input 
                    type="number" 
                    value={row.stock_stdo || ""} 
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRows(rows.map(r => r.id === row.id ? {...r, stock_stdo: val} : r));
                    }}
                    className="w-16 text-center bg-stone-50 rounded-lg py-1 border focus:border-[#C5A065] outline-none"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input 
                    type="number" 
                    value={row.stdo || ""} 
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRows(rows.map(r => r.id === row.id ? {...r, stdo: val} : r));
                    }}
                    className="w-16 text-center bg-stone-50 rounded-lg py-1 border focus:border-[#C5A065] outline-none"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input 
                    type="number" 
                    value={row.berri || ""} 
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRows(rows.map(r => r.id === row.id ? {...r, berri: val} : r));
                    }}
                    className="w-16 text-center bg-stone-50 rounded-lg py-1 border focus:border-[#C5A065] outline-none"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input 
                    type="number" 
                    value={row.comm_berri || ""} 
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRows(rows.map(r => r.id === row.id ? {...r, comm_berri: val} : r));
                    }}
                    className="w-16 text-center bg-stone-50 rounded-lg py-1 border focus:border-[#C5A065] outline-none"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="number"
                    value={row.client || ""}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRows(rows.map(r => r.id === row.id ? {...r, client: val} : r));
                    }}
                    className="w-16 text-center bg-stone-50 rounded-lg py-1 border focus:border-[#C5A065] outline-none"
                  />
                </td>
                <td className="text-center font-bold text-stone-800">
                  {row.stdo + row.comm_berri + row.client}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
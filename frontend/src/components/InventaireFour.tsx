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
  Printer
} from "lucide-react";
import { dailyInventoryAPI } from "../lib/DailyInventoryAPI";

// ─── LISTE DES PRODUITS DE LA FEUILLE FOUR ──────────────────────────────────
const PRODUITS_FOUR_DEFAUT = [
  "Éclair chantilly", "Éclair chocolat", "Éclair pistache", "Mille-feuilles",
  "Tartelette aux fraise", "Tartelette fruits", "Crème brulée", "Tarte aux fraises",
  "Tarte aux fruits", "Tropézienne", "Trop. fraise", "Mini pâtisserie",
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
};

function migrateNames(list: string[]): string[] {
  return list.map((n) => RENAME_MAP[n] || n);
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
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
      const clientFor = (name: string, stored: number) =>
        computedClient ? (computedClient[name] ?? 0) : stored;

      const map = new Map(res.data.entries.map((e: any) => [e.productId, e]));

      const built = products.map(name => {
        const s = map.get(name);
        return {
          id: name,
          name: name,
          stock_stdo: s?.stock_stdo ?? 0,
          stdo: s?.stdo ?? 0,
          berri: s?.berri ?? 0,
          comm_berri: s?.comm_berri ?? 0,
          client: clientFor(name, s?.client ?? 0)
        };
      });

      const historicalRows = res.data.entries
        .filter((entry: any) => !products.includes(entry.productId) && hasInventoryValue(entry))
        .map((entry: any) => ({
          id: entry.productId,
          name: entry.productName,
          stock_stdo: entry.stock_stdo ?? 0,
          stdo: entry.stdo ?? 0,
          berri: entry.berri ?? 0,
          comm_berri: entry.comm_berri ?? 0,
          client: clientFor(entry.productName, entry.client ?? 0),
        }));

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
            const printContent = document.getElementById("inventaire-frais-table");
            if (!printContent) return;
            const win = window.open("", "_blank");
            if (!win) return;
            win.document.write(`
              <html><head><title>Inventaire Frais — ${date}</title>
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
              <h1>Inventaire Frais</h1>
              <p>${new Date(date + "T00:00:00").toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
              ${printContent.outerHTML}
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
                  <div className="flex items-center justify-between">
                    <span>{row.name}</span>
                    <button onClick={() => {
                      if (window.confirm(`Retirer "${row.name}" de la liste pour tous les utilisateurs ?`)) {
                        const up = products.filter(p => p !== row.id);
                        setProducts(up);
                        localStorage.setItem("produits_inventaire_four", JSON.stringify(up));
                        saveProductsToBackend(up);
                      }
                    }} className="text-stone-300 hover:text-red-500 shrink-0"><Trash2 size={14}/></button>
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
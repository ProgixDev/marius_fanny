import { Schema, model } from "mongoose";

export interface IDailyInventoryEntry {
  productId: string;
  productName: string;
  stock_stdo: number | string; // ST-do (stock) — string for SUPPLÉMENT row
  stdo: number | string;       // Comm. St-do
  berri: number | string;      // BERRI
  comm_berri: number | string; // Comm Berri
  client: number | string;     // Comm CLIENT — affiché = auto (commandes) + clientManual
  clientManual?: number;       // ajout manuel de Fanny (delta au-dessus du calcul auto)
  total: number | string;      // auto-calculated: stdo + client only
}

export interface IDailyInventory {
  date: string; 
  entries: IDailyInventoryEntry[];
  savedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DailyInventoryEntrySchema = new Schema<IDailyInventoryEntry>(
  {
    productId: { type: String, required: true },
    productName: { type: String, required: true, trim: true },
    // Mixed type to allow numbers (regular rows) or strings (SUPPLÉMENT row)
    stock_stdo: { type: Schema.Types.Mixed, default: 0 },
    stdo: { type: Schema.Types.Mixed, default: 0 },
    berri: { type: Schema.Types.Mixed, default: 0 },
    comm_berri: { type: Schema.Types.Mixed, default: 0 },
    client: { type: Schema.Types.Mixed, default: 0 },
    clientManual: { type: Number, default: 0 },
    total: { type: Schema.Types.Mixed, default: 0 },
  },
  { _id: false },
);

const DailyInventorySchema = new Schema<IDailyInventory>(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}(__\w+)?$/,
      index: true,
      unique: true,
    },
    entries: { type: [DailyInventoryEntrySchema], default: [] },
    savedBy: { type: String },
  },
  { timestamps: true },
);

export const DailyInventory = model<IDailyInventory>(
  "DailyInventory",
  DailyInventorySchema,
);

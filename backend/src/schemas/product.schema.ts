import { z } from "zod";

/**
 * Product schema
 */
export const productSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100),
  category: z.preprocess(
    (value) => (typeof value === "string" ? [value] : value),
    z.array(z.string().min(1).max(50)).min(1),
  ),
  price: z.number().positive(),
  discountPercentage: z.number().min(0).max(100).default(0),
  available: z.boolean().default(true),
  minOrderQuantity: z.number().int().positive().default(1),
  maxOrderQuantity: z.number().int().positive().default(10),
  description: z.string().max(500).optional(),
  image: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  sales: z.number().int().nonnegative().default(0),
  revenue: z.number().nonnegative().default(0),
  preparationTimeHours: z.number().int().nonnegative().optional(),
  availableDays: z.array(z.number().int().min(0).max(6)).optional(),
  hasTaxes: z.boolean().default(true),
  taxMode: z.enum(["both", "gst_only", "none"]).optional(),
  allergens: z.string().optional(),
  productionType: z.enum(["patisserie", "cuisinier", "four"]),
  targetAudience: z.enum(["clients", "pro"]),
  customOptions: z
    .array(
      z
        .object({
          name: z.string().min(1),
          type: z.enum(["choice", "text"]).optional(),
          choices: z.array(z.string().min(1)).default([]),
        })
        .refine(
          (opt) => (opt.type || "choice") === "text" || opt.choices.length > 0,
          "Les options de type choix doivent avoir au moins un choix",
        ),
    )
    .optional(),
});

/**
 * Create product schema
 */
export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.preprocess(
    (value) => (typeof value === "string" ? [value] : value),
    z.array(z.string().min(1).max(50)).min(1),
  ),
  price: z.number().positive(),
  discountPercentage: z.number().min(0).max(100).optional().default(0),
  available: z.boolean().optional().default(true),
  minOrderQuantity: z.number().int().positive().optional().default(1),
  maxOrderQuantity: z.number().int().positive().optional().default(10),
  description: z.string().max(500).optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  preparationTimeHours: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
  availableDays: z.array(z.number().int().min(0).max(6)).optional(),
  hasTaxes: z.boolean().optional().default(true),
  taxMode: z.enum(["both", "gst_only", "none"]).optional(),
  allergens: z.string().optional(),
  productionType: z.enum(["patisserie", "cuisinier", "four"]),
  targetAudience: z.enum(["clients", "pro"]),
  customOptions: z
    .array(
      z
        .object({
          name: z.string().min(1),
          type: z.enum(["choice", "text"]).optional(),
          choices: z.array(z.string().min(1)).default([]),
        })
        .refine(
          (opt) => (opt.type || "choice") === "text" || opt.choices.length > 0,
          "Les options de type choix doivent avoir au moins un choix",
        ),
    )
    .optional(),
  recommendations: z.array(z.number().int().positive()).optional(),
});

/**
 * Update product schema
 */
export const updateProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(z.string().min(1).max(50)).min(1),
    )
    .optional(),
  price: z.number().positive().optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
  available: z.boolean().optional(),
  minOrderQuantity: z.number().int().positive().optional(),
  maxOrderQuantity: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  preparationTimeHours: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
  availableDays: z.array(z.number().int().min(0).max(6)).optional(),
  hasTaxes: z.boolean().optional(),
  taxMode: z.enum(["both", "gst_only", "none"]).optional(),
  allergens: z.string().optional(),
  productionType: z.enum(["patisserie", "cuisinier", "four"]).optional(),
  targetAudience: z.enum(["clients", "pro"]).optional(),
  customOptions: z
    .array(
      z
        .object({
          name: z.string().min(1),
          type: z.enum(["choice", "text"]).optional(),
          choices: z.array(z.string().min(1)).default([]),
        })
        .refine(
          (opt) => (opt.type || "choice") === "text" || opt.choices.length > 0,
          "Les options de type choix doivent avoir au moins un choix",
        ),
    )
    .optional(),
  recommendations: z.array(z.number().int().positive()).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
});

/**
 * Reorder products schema
 */
export const reorderProductsSchema = z.object({
  orders: z.array(z.object({
    id: z.number().int().positive(),
    displayOrder: z.number().int().nonnegative(),
  })).min(1),
});

/**
 * Product ID param schema
 */
export const productIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Type inference exports
 */
export type ProductInput = z.infer<typeof productSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductIdParam = z.infer<typeof productIdParamSchema>;

import { z } from "zod";

/**
 * User profile schema
 */
export const userProfileSchema = z.object({
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  phoneNumber: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/)
    .optional(),
});

export const billingSchema = z.object({
  kind: z.enum(["standard", "representant", "gouvernement"]).optional(),
  organization: z.string().max(120).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  allowUnpaidOrders: z.boolean().optional(),
});

/**
 * Update current user schema
 */
export const updateCurrentUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  profile: userProfileSchema.optional(),
});

/**
 * Update user by ID schema (admin)
 */
export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(["user", "pro", "staff", "customerService", "admin", "deliveryDriver", "cuisinier", "patissier", "four", "vendeur"]).optional(),
  profile: userProfileSchema.optional(),
  billing: billingSchema.optional(),
  // Client-specific fields
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "inactive", "placeholder"]).optional(),
});

/**
 * Create user profile schema
 */
export const createUserProfileSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  role: z.enum(["user", "pro", "staff", "customerService", "admin", "deliveryDriver", "cuisinier", "patissier", "four", "vendeur"]).optional().default("user"),
});

/**
 * Create client schema (for admin to create clients directly).
 * phone is optional — most self-signup clients won't provide one, and the
 * staff only really needs it if/when sending a Square payment link by SMS.
 * That stricter check happens at payment-link time, not here.
 */
export const createClientSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional().default(""),
  status: z.enum(["active", "inactive", "placeholder"]).optional().default("active"),
  billing: billingSchema.optional(),
});

/**
 * Create staff schema (admin creates staff with email/password/role)
 */
export const createStaffSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(6).max(128),
  role: z.enum([
    "admin",
    "deliveryDriver",
    "cuisinier",
    "patissier",
    "vendeur",
    "pro",
  ]),
  phone: z.string().max(20).optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/**
 * Search users query schema
 */
export const searchUsersSchema = z.object({
  q: z.string().min(1),
});

/**
 * User ID param schema
 */
export const userIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID format"),
});

/**
 * Type inference exports
 */
export type UpdateCurrentUserInput = z.infer<typeof updateCurrentUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateUserProfileInput = z.infer<typeof createUserProfileSchema>;
export type SearchUsersQuery = z.infer<typeof searchUsersSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;

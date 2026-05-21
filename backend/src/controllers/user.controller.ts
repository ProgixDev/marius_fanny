import { Response } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { User } from "../models/User.js";
import Order from "../models/Order.js";
import { AppError } from "../middleware/errorHandler.js";
import { canManageUser } from "../utils/roles.js";
import { auth } from "../config/auth.js";

async function backfillMissingClientsFromOrders() {
  const orderClientRecords = await Order.find({
    "clientInfo.email": { $exists: true, $ne: "" },
  })
    .sort({ orderDate: -1 })
    .select("clientInfo")
    .lean();

  const candidates = new Map<
    string,
    { email: string; name: string; phoneNumber: string }
  >();

  for (const order of orderClientRecords) {
    const email = order.clientInfo?.email?.trim().toLowerCase();
    if (!email || candidates.has(email)) continue;

    const firstName = order.clientInfo?.firstName?.trim() || "";
    const lastName = order.clientInfo?.lastName?.trim() || "";
    const phoneNumber = order.clientInfo?.phone?.trim() || "";

    candidates.set(email, {
      email,
      name: `${firstName} ${lastName}`.trim() || email,
      phoneNumber,
    });
  }

  const emails = [...candidates.keys()];
  if (emails.length === 0) return;

  const existingUsers = await User.find({ email: { $in: emails } })
    .select("email")
    .lean();
  const existingEmails = new Set(
    existingUsers.map((user) => user.email.trim().toLowerCase()),
  );

  const missingClients = emails
    .filter((email) => !existingEmails.has(email))
    .map((email) => {
      const candidate = candidates.get(email)!;
      return {
        email: candidate.email,
        name: candidate.name,
        role: "user" as const,
        status: "active" as const,
        isDeleted: false,
        emailVerified: true,
        profile: {
          phoneNumber: candidate.phoneNumber,
        },
      };
    });

  if (missingClients.length === 0) return;

  await User.insertMany(missingClients, { ordered: false });
  console.log(
    `✅ Backfilled ${missingClients.length} missing client(s) from orders`,
  );
}

/**
 * Get current user profile
 */
export async function getCurrentUser(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      throw new AppError("User not found in request", 401);
    }

    const user = await User.findOne({ email: req.user.email });

    if (!user) {
      throw new AppError("User profile not found", 404);
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to get user profile", 500);
  }
}

/**
 * Get user by ID
 */
export async function getUserById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      throw new AppError("User not found", 404);
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to get user", 500);
  }
}

/**
 * Get all users (paginated)
 */
export async function getAllUsers(req: AuthRequest, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find().skip(skip).limit(limit).sort({ createdAt: -1 }),
      User.countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    throw new AppError("Failed to get users", 500);
  }
}

/**
 * Update current user profile
 */
export async function updateCurrentUser(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      throw new AppError("User not found in request", 401);
    }

    const { name, profile } = req.body;

    const user = await User.findOneAndUpdate(
      { email: req.user.email },
      {
        $set: {
          ...(name && { name }),
          ...(profile && { profile }),
        },
      },
      { new: true, runValidators: true },
    );

    if (!user) {
      throw new AppError("User not found", 404);
    }

    res.json({
      success: true,
      data: user,
      message: "Profile updated successfully",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to update profile", 500);
  }
}

/**
 * Update user by ID (admin only)
 */
export async function updateUser(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { name, role, profile, billing, firstName, lastName, phone, status, email: newEmail } = req.body;

    const normalizeBilling = (input: any, existing?: any) => {
      if (!input) return existing;
      const kind = input.kind || existing?.kind || "standard";
      if (kind === "representant") {
        return {
          kind,
          organization: input.organization ?? existing?.organization,
          paymentTermsDays: 0,
          allowUnpaidOrders: true,
        };
      }
      if (kind === "gouvernement") {
        return {
          kind,
          organization: input.organization ?? existing?.organization,
          paymentTermsDays: Number.isFinite(input.paymentTermsDays)
            ? input.paymentTermsDays
            : existing?.paymentTermsDays ?? 180,
          allowUnpaidOrders: input.allowUnpaidOrders ?? true,
        };
      }
      return {
        kind: "standard",
        organization: input.organization ?? existing?.organization,
        paymentTermsDays: 0,
        allowUnpaidOrders: false,
      };
    };

    // Get current user's role
    const currentUser = await User.findOne({ email: req.user?.email });
    if (!currentUser) {
      throw new AppError("Current user not found", 401);
    }

    // Get target user
    const targetUser = await User.findById(id);
    if (!targetUser) {
      throw new AppError("User not found", 404);
    }

    // Check if current user can manage target user
    if (!canManageUser(currentUser.role, targetUser.role)) {
      throw new AppError("Cannot manage user with equal or higher role", 403);
    }

    // If trying to change role, verify current user can assign that role
    if (role && !canManageUser(currentUser.role, role)) {
      throw new AppError(
        "Cannot assign a role equal to or higher than your own",
        403,
      );
    }

    // Build update object
    const updateFields: Record<string, any> = {};

    // Traditional fields
    if (name) updateFields.name = name;
    if (role) updateFields.role = role;
    if (profile) updateFields.profile = profile;
    if (billing !== undefined) {
      updateFields.billing = normalizeBilling(billing, (targetUser as any).billing);
    }

    // Client-specific fields (from ClientManagement)
    if (firstName !== undefined || lastName !== undefined) {
      const fName = firstName ?? targetUser.name?.split(" ")[0] ?? "";
      const lName = lastName ?? targetUser.name?.split(" ").slice(1).join(" ") ?? "";
      updateFields.name = `${fName} ${lName}`.trim();
    }
    if (phone !== undefined) {
      updateFields["profile.phoneNumber"] = phone;
    }
    if (status !== undefined) {
      updateFields.status = status;
    }
    if (newEmail !== undefined) {
      updateFields.email = newEmail;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      data: user,
      message: "User updated successfully",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to update user", 500);
  }
}

/**
 * Delete user by ID (admin only)
 */
export async function deleteUser(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    // Get current user's role
    const currentUser = await User.findOne({ email: req.user?.email });
    if (!currentUser) {
      throw new AppError("Current user not found", 401);
    }

    // Get target user
    const targetUser = await User.findById(id);
    if (!targetUser) {
      throw new AppError("User not found", 404);
    }

    // Prevent self-deletion
    if (req.user && req.user.email === targetUser.email) {
      throw new AppError("Cannot delete your own account", 400);
    }

    // Check if current user can manage target user
    if (!canManageUser(currentUser.role, targetUser.role)) {
      throw new AppError("Cannot delete user with equal or higher role", 403);
    }

    if (targetUser.role === "user") {
      await User.findByIdAndUpdate(
        id,
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            status: "inactive",
          },
        },
        { runValidators: true },
      );

      return res.json({
        success: true,
        message: "Client supprimé avec succès",
      });
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to delete user", 500);
  }
}

/**
 * Create a new client (admin/staff only)
 */
export async function createClient(req: AuthRequest, res: Response) {
  try {
    const { email, firstName, lastName, phone, status, billing } = req.body;

    const normalizeBilling = (input: any) => {
      const kind = input?.kind || "standard";
      if (kind === "representant") {
        return {
          kind,
          organization: input?.organization,
          paymentTermsDays: 0,
          allowUnpaidOrders: true,
        };
      }
      if (kind === "gouvernement") {
        return {
          kind,
          organization: input?.organization,
          paymentTermsDays: Number.isFinite(input?.paymentTermsDays) ? input.paymentTermsDays : 180,
          allowUnpaidOrders: true,
        };
      }
      return {
        kind: "standard",
        organization: input?.organization,
        paymentTermsDays: 0,
        allowUnpaidOrders: false,
      };
    };

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError("A user with this email already exists", 400);
    }

    // Create user with client data - use MongoDB _id converted to number
    const user = new User({
      email,
      name: `${firstName} ${lastName}`,
      role: "user",
      status: status || "active",
      emailVerified: true, // Admin-created accounts are verified
      profile: {
        phoneNumber: phone,
      },
      billing: normalizeBilling(billing),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await user.save();

    // Convert MongoDB _id to a number for frontend compatibility
    const numericId = parseInt(user._id.toString().slice(-8), 16);

    res.status(201).json({
      success: true,
      data: {
        id: numericId,
        email: user.email,
        firstName,
        lastName,
        phone,
        status: status || "active",
        billing: user.billing,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      message: "Client created successfully",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Create client error:", error);
    throw new AppError("Failed to create client", 500);
  }
}

/**
 * Get all clients (admin/staff only)
 */
export async function getAllClients(req: AuthRequest, res: Response) {
  try {
    console.log("📥 getAllClients called, query:", req.query);
    await backfillMissingClientsFromOrders();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string || "";
    console.log("📊 Parsed params - page:", page, "limit:", limit, "search:", search);
    const skip = (page - 1) * limit;

    // Filter "clients" = anything that's NOT a staff role. We can't strictly
    // require role:"user" because better-auth's MongoDB adapter occasionally
    // creates user docs without the field, which would silently hide brand-new
    // self-signed clients from the admin list. Instead, exclude known staff
    // roles — that keeps the list accurate even for older/buggy records.
    const STAFF_ROLES = [
      "admin",
      "staff",
      "customerService",
      "deliveryDriver",
      "cuisinier",
      "patissier",
      "four",
      "vendeur",
    ];
    const query: any = {
      role: { $nin: STAFF_ROLES },
      isDeleted: { $ne: true },
    };

    // If search is provided, filter by name or email (combined with role filter)
    if (search) {
      query.$and = [
        { role: { $nin: STAFF_ROLES } },
        { isDeleted: { $ne: true } },
        {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        },
      ];
      delete query.role;
      delete query.isDeleted;
    }

    const [users, total] = await Promise.all([
      User.find(query).skip(skip).limit(limit).sort({ createdAt: -1 }),
      User.countDocuments(query),
    ]);

    // Transform users to client format
    const clients = await Promise.all(users.map(async (user) => {
      const numericId = user.id || parseInt(user._id.toString().slice(-8), 16);
      const nameParts = (user.name || "").split(" ");

      // Fetch orders for this client
      const orders = await Order.find({
        $or: [
          { userId: user._id.toString() },
          { "clientInfo.email": user.email },
        ],
      }).sort({ orderDate: -1 });

      return {
        id: numericId,
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" "),
        email: user.email,
        phone: user.profile?.phoneNumber || "",
        status: (user.status || "active") as "active" | "inactive" | "placeholder",
        billing: (user as any).billing,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        addresses: [],
        orders: orders.map((order) => ({
          id: order._id.toString(),
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          status: order.status,
          total: order.total,
          items: order.items,
          pickupDate: order.pickupDate,
          pickupLocation: order.pickupLocation,
          deliveryType: order.deliveryType,
        })),
      };
    }));

    res.json({
      success: true,
      data: {
        clients,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    throw new AppError("Failed to get clients", 500);
  }
}

/**
 * Search clients by email (for autocomplete)
 */
export async function searchClients(req: AuthRequest, res: Response) {
  try {
    const q = req.query.q as string;
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    // Search clients = anything that's NOT a staff role (same rationale as
    // getAllClients: better-auth signups sometimes have role undefined).
    const STAFF_ROLES = [
      "admin",
      "staff",
      "customerService",
      "deliveryDriver",
      "cuisinier",
      "patissier",
      "four",
      "vendeur",
    ];
    const users = await User.find({
      role: { $nin: STAFF_ROLES },
      isDeleted: { $ne: true },
      $or: [
        { email: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
      ],
    })
      .limit(10)
      .select("id email name profile.phoneNumber");

    const clients = users.map((user) => {
      const numericId = user.id || parseInt(user._id.toString().slice(-8), 16);
      return {
        id: numericId,
        firstName: user.name.split(" ")[0],
        lastName: user.name.split(" ").slice(1).join(" "),
        email: user.email,
        phone: user.profile?.phoneNumber || "",
      };
    });

    res.json({
      success: true,
      data: clients,
    });
  } catch (error) {
    throw new AppError("Failed to search clients", 500);
  }
}

/**
 * Search users by name or email
 */
export async function searchUsers(req: AuthRequest, res: Response) {
  try {
    const { q } = req.query;

    if (!q || typeof q !== "string") {
      throw new AppError("Search query is required", 400);
    }

    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ],
    }).limit(20);

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to search users", 500);
  }
}

/**
 * Create a staff member with email/password/role.
 * Uses better-auth signUp.email to properly create user + account (with hashed password),
 * then updates the role and forces emailVerified=true.
 */
export async function createStaff(req: AuthRequest, res: Response) {
  try {
    const { email, name, password, role, phone } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing && !existing.isDeleted) {
      throw new AppError("Un utilisateur avec cet email existe déjà", 400);
    }

    // Step 1: create user via better-auth (creates user + account record with hashed password)
    try {
      await auth.api.signUpEmail({
        body: { email, password, name },
      });
    } catch (e: any) {
      // If user was created but signUp threw because of email verification flow, that's OK
      const msg = String(e?.message || "").toLowerCase();
      if (!msg.includes("already") && !msg.includes("exists")) {
        console.error("signUpEmail error:", e);
      }
    }

    // Step 2: update the role + emailVerified directly in the DB
    const updated = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $set: {
          role,
          emailVerified: true,
          status: "active",
          name,
          ...(phone ? { profile: { phoneNumber: phone } } : {}),
        },
        $unset: {
          isDeleted: 1,
          deletedAt: 1,
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new AppError("Failed to create staff member", 500);
    }

    res.status(201).json({
      success: true,
      data: {
        id: updated._id.toString(),
        email: updated.email,
        name: updated.name,
        role: updated.role,
        phone: updated.profile?.phoneNumber || "",
        status: updated.status,
        createdAt: updated.createdAt,
      },
      message: "Staff member created successfully",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("createStaff error:", error);
    throw new AppError("Failed to create staff member", 500);
  }
}

/**
 * Get all staff members (excludes clients with role 'user' and 'pro').
 */
export async function getAllStaff(req: AuthRequest, res: Response) {
  try {
    const staffRoles = [
      "admin",
      "customerService",
      "deliveryDriver",
      "cuisinier",
      "patissier",
      "four",
      "vendeur",
      "staff",
    ];

    const staff = await User.find({
      role: { $in: staffRoles },
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .lean();

    const formatted = staff.map((u: any) => ({
      id: u._id.toString(),
      email: u.email,
      name: u.name,
      role: u.role,
      phone: u.profile?.phoneNumber || "",
      status: u.status || "active",
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error("getAllStaff error:", error);
    throw new AppError("Failed to fetch staff", 500);
  }
}

/**
 * Update a staff member (role, status, name, phone, password).
 */
export async function updateStaff(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { name, role, phone, status, password } = req.body;

    const user = await User.findById(id);
    if (!user) {
      throw new AppError("Staff member not found", 404);
    }

    if (name) user.name = name;
    if (role) user.role = role;
    if (status) user.status = status;
    if (phone !== undefined) {
      user.profile = { ...(user.profile || {}), phoneNumber: phone };
    }

    await user.save();

    // Password change is not supported via this admin endpoint for now
    // (would require either auth.api.setPassword which is user-scoped, or direct DB access)
    if (password) {
      console.warn("Password change via updateStaff is not implemented");
    }

    res.json({
      success: true,
      data: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.profile?.phoneNumber || "",
        status: user.status,
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("updateStaff error:", error);
    throw new AppError("Failed to update staff member", 500);
  }
}

/**
 * Delete a staff member (soft delete).
 */
export async function deleteStaff(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndUpdate(
      id,
      { $set: { isDeleted: true, deletedAt: new Date(), status: "inactive" } },
      { new: true },
    );

    if (!user) {
      throw new AppError("Staff member not found", 404);
    }

    res.json({ success: true, message: "Staff member deleted" });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("deleteStaff error:", error);
    throw new AppError("Failed to delete staff member", 500);
  }
}

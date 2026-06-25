import { Router } from "express";
import {
  requireAuth,
  requireRole,
  requireStaff,
  requireAdmin,
} from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../middleware/validation.js";
import * as userController from "../controllers/user.controller.js";
import {
  updateCurrentUserSchema,
  updateUserSchema,
  searchUsersSchema,
  userIdParamSchema,
  createClientSchema,
  createStaffSchema,
} from "../schemas/user.schema.js";
import {
  paginationQuerySchema,
} from "../schemas/common.schema.js";

const router = Router();

/**
 * @route   GET /api/users/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get("/me", requireAuth, asyncHandler(userController.getCurrentUser));

/**
 * @route   PUT /api/users/me
 * @desc    Update current user profile
 * @access  Private
 */
router.put(
  "/me",
  requireAuth,
  validateBody(updateCurrentUserSchema),
  asyncHandler(userController.updateCurrentUser),
);

/**
 * @route   GET /api/users/search
 * @desc    Search users by name or email
 * @access  Private
 */
router.get(
  "/search",
  requireAuth,
  validateQuery(searchUsersSchema),
  asyncHandler(userController.searchUsers),
);

/**
 * @route   GET /api/users
 * @desc    Get all users (paginated)
 * @access  Private (Admin only)
 */
router.get(
  "/",
  requireAuth,
  requireAdmin,
  validateQuery(paginationQuerySchema),
  asyncHandler(userController.getAllUsers),
);

/**
 * @route   POST /api/users/clients
 * @desc    Create a new client
 * @access  Private (Admin/Staff)
 */
router.post(
  "/clients",
  requireAuth,
  requireStaff,
  validateBody(createClientSchema),
  asyncHandler(userController.createClient),
);

/**
 * @route   GET /api/users/clients
 * @desc    Get all clients (paginated)
 * @access  Private (Admin/Staff)
 */
router.get(
  "/clients",
  requireAuth,
  requireStaff,
  asyncHandler(userController.getAllClients),
);

/**
 * @route   GET /api/users/clients/search
 * @desc    Search clients by email or name
 * @access  Private (Admin/Staff)
 */
router.get(
  "/clients/search",
  requireAuth,
  requireStaff,
  asyncHandler(userController.searchClients),
);

/**
 * @route   PUT /api/users/clients/:id
 * @desc    Update a client (staff-accessible; clients only, never staff/admin)
 * @access  Private (Admin/Staff)
 */
router.put(
  "/clients/:id",
  requireAuth,
  requireStaff,
  validateParams(userIdParamSchema),
  asyncHandler(userController.updateClient),
);

/**
 * @route   POST /api/users/staff
 * @desc    Create a new staff member with email/password/role
 * @access  Private (Admin only)
 */
router.post(
  "/staff",
  requireAuth,
  requireAdmin,
  validateBody(createStaffSchema),
  asyncHandler(userController.createStaff),
);

/**
 * @route   GET /api/users/staff
 * @desc    Get all staff members
 * @access  Private (Admin only)
 */
router.get(
  "/staff",
  requireAuth,
  requireAdmin,
  asyncHandler(userController.getAllStaff),
);

/**
 * @route   PUT /api/users/staff/:id
 * @desc    Update a staff member
 * @access  Private (Admin only)
 */
router.put(
  "/staff/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(userController.updateStaff),
);

/**
 * @route   DELETE /api/users/staff/:id
 * @desc    Delete a staff member
 * @access  Private (Admin only)
 */
router.delete(
  "/staff/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(userController.deleteStaff),
);

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Private
 */
router.get(
  "/:id",
  requireAuth,
  validateParams(userIdParamSchema),
  asyncHandler(userController.getUserById),
);

/**
 * @route   PUT /api/users/:id
 * @desc    Update user by ID
 * @access  Private (Admin only)
 */
router.put(
  "/:id",
  requireAuth,
  requireAdmin,
  validateParams(userIdParamSchema),
  validateBody(updateUserSchema),
  asyncHandler(userController.updateUser),
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user by ID
 * @access  Private (Admin only)
 */
router.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  validateParams(userIdParamSchema),
  asyncHandler(userController.deleteUser),
);

export default router;

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { AppError } from "../middleware/errorHandler.js";
import crypto from "crypto";
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";

// 1. DEMANDE DE RESET (Envoi de l'email)
export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    if (!email) return next(new AppError("Email requis", 400));

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return next(new AppError("Utilisateur non trouvé", 404));

    // Génération du token
    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 3600000); // Valide 1h
    await user.save();

    // Configuration SMTP
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${token}`;

    await transporter.sendMail({
      from: `"Marius & Fanny" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Réinitialisation de mot de passe",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
          <h2 style="color: #C5A065;">Réinitialisation de mot de passe</h2>
          <p>Vous avez demandé à changer votre mot de passe.</p>
          <p>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
          <a href="${resetLink}" style="background: #C5A065; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Réinitialiser mon mot de passe</a>
          <p style="margin-top: 20px; font-size: 12px; color: gray;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true, message: "Email envoyé" });
  } catch (error) {
    next(error);
  }
};

// 2. VALIDATION DU NOUVEAU MOT DE PASSE
//
// Important: better-auth stores credentials in a SEPARATE `account` collection
// (one row per provider, e.g. "credential" for email/password). Writing the
// hash to `user.password` on the User model does nothing for sign-in — the
// next login attempt still checks the old hash on `account` and fails, which
// is exactly what was reported as "il fallait écrire l'ancien mot de passe".
//
// We therefore update the bcrypt hash directly in the `account` collection
// for providerId="credential" + userId=<user._id>. Mongoose's native
// collection access bypasses the schema (account isn't a Mongoose model).
export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) return next(new AppError("Données manquantes", 400));
    if (typeof newPassword !== "string" || newPassword.length < 5) {
      return next(new AppError("Le mot de passe doit contenir au moins 5 caractères", 400));
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) return next(new AppError("Lien invalide ou expiré", 400));

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    // 1) Update better-auth's credential row in the `account` collection.
    const db = mongoose.connection.db;
    if (!db) {
      return next(new AppError("Connexion BDD indisponible", 500));
    }
    const accounts = db.collection("account");
    const userIdStr = user._id.toString();
    // better-auth's adapter stores userId as a string; some versions store it
    // as ObjectId. Match either form so the update lands.
    const accountResult = await accounts.updateOne(
      {
        providerId: "credential",
        $or: [
          { userId: userIdStr },
          { userId: user._id },
        ],
      },
      { $set: { password: newHash, updatedAt: new Date() } },
    );

    if (accountResult.matchedCount === 0) {
      // No credential row found — this typically means the account was
      // created via social login or never had a password. We create one so
      // the customer can now sign in by email + password.
      await accounts.insertOne({
        userId: userIdStr,
        providerId: "credential",
        accountId: userIdStr,
        password: newHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`🔑 [RESET] Created new credential account for ${user.email}`);
    } else {
      console.log(`🔑 [RESET] Updated credential password for ${user.email}`);
    }

    // 2) Clear the reset token on the User document.
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    // We also keep the hash on the User model for any legacy code paths
    // that read it; it's a no-op for better-auth itself.
    user.password = newHash;
    await user.save();

    return res.status(200).json({ success: true, message: "Mot de passe modifié avec succès" });
  } catch (error) {
    next(error);
  }
};

// Get current session info
export const getSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Assuming req.user is set by requireAuth middleware
    const user = req.user;
    if (!user) return next(new AppError("Non authentifié", 401));

    return res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// Check email verification status
export const checkEmailVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) return next(new AppError("Non authentifié", 401));

    return res.status(200).json({ success: true, emailVerified: user.emailVerified });
  } catch (error) {
    next(error);
  }
};

// Sync Better Auth user with Mongoose User model
export const syncUserProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) return next(new AppError("Non authentifié", 401));

    // Sync logic here if needed
    return res.status(200).json({ success: true, message: "Profil synchronisé" });
  } catch (error) {
    next(error);
  }
};

// Get user stats for dashboard
export const getUserStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) return next(new AppError("Non authentifié", 401));

    // Dummy stats
    const stats = {
      totalOrders: 0,
      totalSpent: 0,
      lastOrder: null,
    };

    return res.status(200).json({ success: true, stats });
  } catch (error) {
    next(error);
  }
};

// Create user profile after authentication
export const createUserProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, name } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return next(new AppError("Utilisateur existe déjà", 400));

    const user = new User({
      email,
      name,
      role: "user",
      emailVerified: false,
    });

    await user.save();

    return res.status(201).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

// Ensure API_URL has protocol
export const normalizedApiUrl = API_URL.startsWith('http') ? API_URL : `https://${API_URL}`;

// localStorage throws SecurityError in some environments — iOS Safari private
// browsing, in-app webviews (Gmail/Outlook), strict cookie policies, etc.
// Wrapping every access keeps the auth client from taking the whole page
// down when the email facture link is opened on a phone.
const safeGetItem = (key: string): string | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
};
const safeSetItem = (key: string, value: string): void => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    /* storage blocked — ignore */
  }
};
const safeRemoveItem = (key: string): void => {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    /* storage blocked — ignore */
  }
};

// Custom fetch implementation that ALWAYS injects bearer token
const authFetch: typeof fetch = (input, init) => {
  const token = safeGetItem("bearer_token");
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return window.fetch(input, { ...init, headers, credentials: "include" });
};

export const authClient = createAuthClient({
  baseURL: normalizedApiUrl,
  fetchOptions: {
    credentials: 'include',
    customFetchImpl: authFetch as any,
    onRequest(context) {
      const token = safeGetItem("bearer_token");
      if (token) {
        context.headers.set("Authorization", `Bearer ${token}`);
      }
    },
    onSuccess(context) {
      const token = context.response.headers.get("set-auth-token");
      if (token) {
        safeSetItem("bearer_token", token);
      }
      if (context.response.url?.includes("/sign-out")) {
        safeRemoveItem("bearer_token");
      }
    },
  },
  plugins: [emailOTPClient()],
  user: {
    additionalFields: {
      role: {
        type: "string"
      }
    }
  }
});

export const forgotPassword = async (email: string) => {
  const response = await fetch(`${normalizedApiUrl}/api/auth-password/forgot_password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const contentType = response.headers.get("content-type");
  
  if (!response.ok) {
    const errorData = contentType?.includes("application/json") 
      ? await response.json() 
      : { message: "Route introuvable (404)" };

    throw new Error(errorData.message || "Une erreur est survenue");
  }

  return response.json();
};

export const sendVerificationEmail = async (email: string, callbackURL?: string) => {
  return await authClient.sendVerificationEmail({
    email,
    callbackURL: callbackURL || "/",
  });
};

export const verifyEmail = async (token: string) => {
  return await authClient.verifyEmail({
    query: { token },
  });
};

// Email OTP helper functions
export const sendVerificationOTP = async (email: string, type: "email-verification" | "sign-in" | "forget-password" = "email-verification") => {
  return await authClient.emailOtp.sendVerificationOtp({
    email,
    type,
  });
};

export const verifyEmailOTP = async (email: string, otp: string) => {
  return await authClient.emailOtp.verifyEmail({
    email,
    otp,
  });
};
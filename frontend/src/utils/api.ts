/**
 * Central API URL configuration.
 * In production, VITE_API_URL must be set to the deployed backend URL.
 * In development, falls back to http://localhost:3000.
 */
export const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

/**
 * Resolves an image URL so it works both in development and production.
 *
 * - Cloudinary URLs get on-the-fly optimization transformations injected
 *   (f_auto = modern format like WebP/AVIF, q_auto = automatic quality,
 *   w_<width> = resized to the display size). This makes thumbnails ~10x
 *   lighter instead of downloading the full 1000x1000 upload.
 * - Relative paths like `/uploads/image.jpg` are prefixed with the backend API URL
 * - Other full URLs (http/https) are returned as-is
 * - Empty/falsy values return the fallback
 *
 * @param width Target display width in pixels. Cloudinary resizes the image
 *              to this width (only for Cloudinary URLs). Omit for full size.
 */
export function getImageUrl(
  url: string | undefined | null,
  fallback: string = '',
  width?: number
): string {
  if (!url) return fallback;

  // Cloudinary URL — inject optimization transformations into the upload path.
  if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
    const transforms = ['f_auto', 'q_auto', 'c_limit'];
    if (width) transforms.push(`w_${width}`);
    // Avoid double-injecting if a transformation is already present.
    if (/\/upload\/(f_auto|q_auto|w_|c_)/.test(url)) {
      return url;
    }
    return url.replace('/upload/', `/upload/${transforms.join(',')}/`);
  }

  // Already a full URL (other CDN) — return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // Relative path like /uploads/image.jpg — prepend backend URL
  if (url.startsWith('/')) {
    return `${API_URL}${url}`;
  }

  return url || fallback;
}

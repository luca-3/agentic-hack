import { LOTSE_DEFAULTS } from "@lotse/shared";

/**
 * Valo runtime URL. Local dev: http://localhost:3001 (LOTSE_DEFAULTS). Hosted build:
 *   WXT_LOTSE_SERVER_URL=https://<workspace>.codesphere.com npm run build -w @lotse/extension
 * (wxt.config.ts adds the same origin to host_permissions).
 */
export const SERVER_URL: string = String(import.meta.env.WXT_LOTSE_SERVER_URL || LOTSE_DEFAULTS.serverUrl).replace(/\/+$/, "");

/** Demo credentials (seed) are only valid against a local server — hosted accounts get new passwords. */
export const IS_LOCAL_SERVER = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SERVER_URL);

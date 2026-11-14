#!/usr/bin/env node
// Prints the legacy Supabase API keys (HS256 JWTs signed with JWT_SECRET) for anon and service_role.
// Output goes to stdout only — paste the two values into the Codesphere workspace variables, never commit them.
//
//   JWT_SECRET=… node infra/codesphere/make-jwts.mjs
//
// Why JWTs and not the new sb_publishable_… / sb_secret_… keys: those are opaque strings that only
// Supabase's API gateway (Kong) swaps for a JWT. Without the gateway PostgREST and GoTrue only understand
// JWTs, so supabase-js must be given these legacy keys.
import { createHmac } from "node:crypto";

const secret = process.env.JWT_SECRET;
// Never the well-known local Supabase default (public in every Supabase repo/doc).
const LOCAL_DEFAULT = "super-secret-jwt-token-with-at-least-32-characters-long";
if (!secret || secret.length < 64 || secret === LOCAL_DEFAULT) {
  console.error("JWT_SECRET missing, shorter than 64 characters or the local Supabase default (use: openssl rand -base64 64 | tr -d '\\n')");
  process.exit(1);
}

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const sign = (role) => {
  const data = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role, iat: now, exp: now + 10 * 365 * 24 * 3600 })}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
};

console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${sign("anon")}`);
console.log(`SUPABASE_SECRET_KEY=${sign("service_role")}`);

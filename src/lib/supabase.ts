import { createClient } from "@supabase/supabase-js";
import { describeError } from "./errors";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key && !key.startsWith("replace-"));

// Only the public anon/publishable key is ever used in the browser. Authorization is
// enforced by Postgres RLS and SECURITY DEFINER RPCs, never by hiding UI.
export const supabase = createClient(url ?? "http://localhost:54321", key ?? "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "vfv-auth" },
});

/** Call an RPC and throw a readable AppError on failure. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

export class AppError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export function toAppError(error: { message?: string; details?: string | null; code?: string; hint?: string | null } | Error): AppError {
  const raw = "message" in error && error.message ? error.message : String(error);
  const code = raw.split(":")[0].trim();
  let detail: unknown = "details" in error ? error.details : undefined;
  if (typeof detail === "string") {
    try {
      detail = JSON.parse(detail);
    } catch {
      /* keep string */
    }
  }
  return new AppError(code, describeError(raw, detail as Parameters<typeof describeError>[1]), detail);
}

/** Unwrap a PostgREST query result. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw toAppError(res.error as Error);
  return res.data as T;
}

export function fileUrl(path: string | null | undefined, expiresIn = 3600) {
  if (!path) return Promise.resolve(null);
  return supabase.storage
    .from("org-files")
    .createSignedUrl(path, expiresIn)
    .then(({ data }) => data?.signedUrl ?? null);
}

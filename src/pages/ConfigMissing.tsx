import { LogoMark } from "@/components/layout/Logo";

export function ConfigMissing() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md">
        <LogoMark className="mb-5 size-12" />
        <h1 className="font-display text-2xl font-semibold">Connect a Supabase project</h1>
        <p className="mt-2 text-muted">
          Copy <code>.env.example</code> to <code>.env.local</code>, set <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server. For a fully local backend run{" "}
          <code>npm run stack:start</code>.
        </p>
      </div>
    </div>
  );
}

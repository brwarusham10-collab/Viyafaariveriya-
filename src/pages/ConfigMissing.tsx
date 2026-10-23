import { LogoMark } from "@/components/layout/Logo";

/** Shown when the build has no Supabase connection configured. */
export function ConfigMissing() {
  const dev = import.meta.env.DEV;
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md">
        <LogoMark className="mb-5 size-12" />
        <h1 className="font-display text-2xl font-semibold">{dev ? "Connect a Supabase project" : "Viyafaariveriyaa is almost ready"}</h1>
        {dev ? (
          <p className="mt-2 text-muted">
            Copy <code>.env.example</code> to <code>.env.local</code>, set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server. For a fully local backend run{" "}
            <code>npm run stack:start</code>.
          </p>
        ) : (
          <p className="mt-2 text-muted">
            The site is deployed but isn't connected to its database yet. Add the Supabase project URL and anon key to{" "}
            <code>.env.production</code> in the repository (or as GitHub Actions variables) and it will redeploy automatically.
          </p>
        )}
      </div>
    </div>
  );
}

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/app/auth";
import { Wordmark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { describeError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { appUrl, cn } from "@/lib/utils";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().optional(),
});
type Values = z.infer<typeof schema>;

function ReceiptPreview() {
  const lines: [string, string, string][] = [
    ["Tuna chunks 185g", "3 × 18.50", "55.50"],
    ["Basmati rice 5kg", "1 × 142.00", "142.00"],
    ["Coconut milk 400ml", "4 × 16.25", "65.00"],
  ];
  return (
    <div className="relative w-[300px] rotate-[-2deg] select-none rounded-t-md bg-[#fbfcfb] px-5 pb-8 pt-5 font-mono text-[11.5px] leading-5 text-[#22343a] shadow-[0_30px_60px_-25px_rgba(0,0,0,.6)]">
      <div className="text-center font-sans text-[13px] font-semibold tracking-wide">MAAFUSHI MART</div>
      <div className="text-center text-[10.5px] text-[#6b7b80]">Inv MAIN-004182 · GST reg. 1023xxx</div>
      <div className="my-2 border-t border-dashed border-[#c4cdcc]" />
      {lines.map(([n, q, t]) => (
        <div key={n}>
          <div>{n}</div>
          <div className="flex justify-between text-[#6b7b80]">
            <span>{q}</span>
            <span className="text-[#22343a]">{t}</span>
          </div>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-[#c4cdcc]" />
      <div className="flex justify-between text-[#6b7b80]">
        <span>incl. GST 8%</span>
        <span>19.44</span>
      </div>
      <div className="mt-1 flex justify-between font-sans text-[15px] font-semibold">
        <span>MVR</span>
        <span>262.50</span>
      </div>
      <div className="flex justify-between text-[#6b7b80]">
        <span>Cash 300.00</span>
        <span>Change 37.50</span>
      </div>
      <svg className="absolute -bottom-[7px] left-0 h-2 w-full" preserveAspectRatio="none" viewBox="0 0 30 2">
        <path d="M0 0 L1 2 L2 0 L3 2 L4 0 L5 2 L6 0 L7 2 L8 0 L9 2 L10 0 L11 2 L12 0 L13 2 L14 0 L15 2 L16 0 L17 2 L18 0 L19 2 L20 0 L21 2 L22 0 L23 2 L24 0 L25 2 L26 0 L27 2 L28 0 L29 2 L30 0 Z" fill="#fbfcfb" />
      </svg>
    </div>
  );
}

export function LoginPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = React.useState<"signin" | "signup" | "forgot">("signin");
  const form = useForm<Values>({ resolver: zodResolver(schema) });

  if (session) return <Navigate to={(location.state as { from?: string } | null)?.from ?? "/"} replace />;

  const onSubmit = form.handleSubmit(async ({ email, password = "" }) => {
    if (mode !== "forgot" && password.length < 8) {
      form.setError("password", { message: "Use at least 8 characters" });
      return;
    }
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/");
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: appUrl("onboarding") } });
        if (error) throw error;
        if (data.session) navigate("/onboarding");
        else toast.success("Check your inbox to confirm your email, then sign in.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl("reset-password") });
        if (error) throw error;
        toast.success("If that email has an account, a reset link is on its way.");
        setMode("signin");
      }
    } catch (e) {
      toast.error(describeError((e as Error).message === "Invalid login credentials" ? "Email or password is incorrect." : (e as Error).message));
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-reef px-12 py-10 text-white lg:flex lg:flex-col">
        <Wordmark />
        <div className="mt-auto max-w-md">
          <h1 className="font-display text-[44px] font-semibold leading-[1.02] tracking-tight">
            Ring up, restock and close the day without the paperwork.
          </h1>
          <p className="mt-4 max-w-sm text-[15px] text-reef-text">
            Point of sale, stock, purchasing and GST reporting for shops across the atolls. Prices in MVR, receipts on any printer.
          </p>
        </div>
        <div className="pointer-events-none absolute right-12 top-24 hidden xl:block">
          <ReceiptPreview />
        </div>
        <div className="mt-10 text-xs text-reef-text/60">Times shown in Maldives time (UTC+5)</div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark className="text-fg" />
          </div>
          <h2 className="font-display text-2xl font-semibold">
            {mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {mode === "signin"
              ? "Use the email your business invited, or the one you registered with."
              : mode === "signup"
                ? "Next you'll set up your business, first outlet and tax rates."
                : "We'll email you a link to choose a new password."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
            <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
            </Field>
            {mode !== "forgot" && (
              <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
                <Input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  {...form.register("password")} aria-invalid={!!form.formState.errors.password} />
              </Field>
            )}
            <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
            </Button>
          </form>

          <div className="mt-6 flex flex-col gap-2 text-sm">
            {mode === "signin" && (
              <>
                <button className="text-start text-lagoon hover:underline" onClick={() => setMode("forgot")}>
                  Forgot your password?
                </button>
                <p className="text-muted">
                  New to Viyafaariveriyaa?{" "}
                  <button className="font-medium text-lagoon hover:underline" onClick={() => setMode("signup")}>
                    Create an account
                  </button>
                </p>
              </>
            )}
            {mode !== "signin" && (
              <button className={cn("text-start text-lagoon hover:underline")} onClick={() => setMode("signin")}>
                Back to sign in
              </button>
            )}
          </div>
          {import.meta.env.VITE_SHOW_DEMO_LOGIN === "true" && mode === "signin" && (
            <p className="mt-8 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
              Demo data: <span className="font-medium text-fg">owner@demo.mv</span> / <span className="font-medium text-fg">Demo#2026pos</span>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

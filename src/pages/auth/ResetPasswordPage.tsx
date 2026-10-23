import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Wordmark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

/** Landing page for the email reset link; Supabase signs the user in from the URL fragment. */
export function ResetPasswordPage() {
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const navigate = useNavigate();
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password.length < 8) return toast.error("Use at least 8 characters.");
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password });
          setBusy(false);
          if (error) return toast.error(error.message);
          toast.success("Password updated.");
          navigate("/");
        }}>
        <Wordmark className="mb-6" />
        <h1 className="font-display text-2xl font-semibold">Choose a new password</h1>
        <Field label="New password" htmlFor="new-password">
          <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}

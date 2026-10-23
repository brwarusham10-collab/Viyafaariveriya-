import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionState {
  orgId: string | null;
  outletId: string | null;
  registerId: string | null;
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  setOrg: (id: string | null) => void;
  setOutlet: (id: string | null) => void;
  setRegister: (id: string | null) => void;
  setTheme: (t: "light" | "dark" | "system") => void;
  toggleSidebar: () => void;
}

// UI selection only. The server re-checks every org/outlet/register on each request.
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      orgId: null,
      outletId: null,
      registerId: null,
      theme: "system",
      sidebarCollapsed: false,
      setOrg: (orgId) => set({ orgId, outletId: null, registerId: null }),
      setOutlet: (outletId) => set({ outletId, registerId: null }),
      setRegister: (registerId) => set({ registerId }),
      setTheme: (theme) => {
        try {
          if (theme === "system") localStorage.removeItem("vfv-theme");
          else localStorage.setItem("vfv-theme", theme);
        } catch {
          /* storage unavailable */
        }
        const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.classList.toggle("dark", dark);
        set({ theme });
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "vfv-session" },
  ),
);

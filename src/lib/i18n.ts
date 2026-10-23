// Localisation scaffold. Strings are English today; Dhivehi (dv, RTL) can be added by
// supplying a dictionary and flipping `dir`. Components already use logical CSS properties
// (ps/pe/ms/me, start/end) so layouts mirror correctly.
export type Locale = "en" | "dv";

const dictionaries: Record<Locale, Record<string, string>> = {
  en: {},
  dv: {},
};

let current: Locale = "en";

export function setLocale(locale: Locale) {
  current = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "dv" ? "rtl" : "ltr";
}

/** t("Charge") → translated string, falling back to the English source text. */
export function t(source: string): string {
  return dictionaries[current][source] ?? source;
}

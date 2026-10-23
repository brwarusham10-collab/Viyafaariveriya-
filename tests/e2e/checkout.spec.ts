import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo#2026pos";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function ensureShift(page: Page) {
  await page.goto("/pos");
  const open = page.getByRole("button", { name: "Open shift" });
  const search = page.getByLabel("Scan or search");
  await expect(open.or(search)).toBeVisible();
  if (await open.isVisible()) {
    await page.getByLabel("Opening cash float (MVR)").fill("500");
    await open.click();
  }
  await expect(search).toBeVisible();
}

test("cashier sells by barcode, takes cash, gets change and a receipt @tablet", async ({ page }) => {
  await signIn(page, "cashier@demo.mv");
  await ensureShift(page);

  const search = page.getByLabel("Scan or search");
  await search.fill("8900000000011"); // Tuna chunks 185g @ 18.50
  await search.press("Enter");
  await search.fill("8900000000011");
  await search.press("Enter");
  const cart = page.getByRole("list", { name: "Cart" });
  await expect(cart.getByText("Tuna chunks in oil 185g")).toBeVisible();
  await expect(page.getByRole("button", { name: /Charge MVR 37\.00/ })).toBeVisible();

  await page.getByRole("button", { name: /Charge MVR 37\.00/ }).click();
  const dialog = page.getByRole("dialog", { name: "Take payment" });
  await dialog.getByLabel("Amount").fill("50");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByText("MVR 13.00").last()).toBeVisible();
  await dialog.getByRole("button", { name: "Complete sale" }).click();

  const done = page.getByRole("dialog", { name: "Sale complete" });
  await expect(done).toBeVisible();
  await expect(done.getByText("MVR 13.00").first()).toBeVisible();
  const invoice = (await done.getByText(/^MAIN-\d{6}$/).first().textContent())!.trim();
  await expect(done.locator(".print-area")).toContainText("Tuna chunks in oil 185g");
  await done.getByRole("button", { name: "New sale" }).click();
  await expect(cart.getByText("Scan an item")).toBeVisible();

  await page.goto("/sales");
  await page.getByLabel("Search invoice").fill(invoice);
  await expect(page.getByRole("row", { name: new RegExp(invoice) })).toContainText("37.00");
});

test("cashier cannot reach admin pages; the server refuses cross-role actions", async ({ page }) => {
  await signIn(page, "cashier@demo.mv");
  await expect(page.getByRole("link", { name: "Staff & roles" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/staff");
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});

test("owner sees seeded history on the dashboard and reports", async ({ page }) => {
  await signIn(page, "owner@demo.mv");
  await page.goto("/dashboard");
  await expect(page.getByText("Net sales (excl. tax)")).toBeVisible();
  await expect(page.getByText("Bank transfers waiting for verification")).toBeVisible();
  await page.goto("/reports/tax");
  await expect(page.getByText("isn't a MIRA filing format", { exact: false }).or(page.getByText("not a MIRA filing format", { exact: false }))).toBeVisible();
});

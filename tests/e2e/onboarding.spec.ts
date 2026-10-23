import { expect, test } from "@playwright/test";

test("a new owner signs up, sets up a business, adds a product and sells it", async ({ page }) => {
  const email = `owner${Date.now()}@example.mv`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Owner#Pass2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel("Business name").fill("Thoddoo Corner Shop");
  await page.getByLabel("TIN").fill("1099999GST001");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Outlet code").fill("THD");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Tax rate").first().fill("8");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page).toHaveURL(/\/products\/new/);
  await page.getByLabel("Name", { exact: true }).fill("Watermelon slice");
  await page.getByLabel("Retail price").fill("12.00");
  await page.getByLabel("Cost price").fill("5.00");
  await page.getByLabel("Barcodes").fill("2999000000019");
  await page.getByLabel("Opening stock").fill("20");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "Watermelon slice" })).toBeVisible();

  await page.goto("/pos");
  await page.getByLabel("Opening cash float (MVR)").fill("200");
  await page.getByRole("button", { name: "Open shift" }).click();
  const search = page.getByLabel("Scan or search");
  await search.fill("2999000000019");
  await search.press("Enter");
  await page.getByRole("button", { name: /Charge MVR 12\.00/ }).click();
  const pay = page.getByRole("dialog", { name: "Take payment" });
  await pay.getByRole("button", { name: "Card" }).click();
  await pay.getByRole("button", { name: "Add" }).click();
  await pay.getByRole("button", { name: "Complete sale" }).click();
  const done = page.getByRole("dialog", { name: "Sale complete" });
  await expect(done.getByText("THD-000001", { exact: true }).first()).toBeVisible();
  await expect(done.locator(".print-area")).toContainText("Thoddoo Corner Shop");
  await expect(done.locator(".print-area")).toContainText("TIN 1099999GST001");
  await done.getByRole("button", { name: "New sale" }).click();

  await page.goto("/inventory");
  await expect(page.getByRole("row", { name: /Watermelon slice/ })).toContainText("19");
});

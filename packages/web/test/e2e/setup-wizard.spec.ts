import { expect, test } from '@playwright/test';

/**
 * SETUP-02 verification — D-13 / Pitfall 2: the AgentSession UI Visibility
 * warning gates Linear OAuth.
 *
 * THE LOAD-BEARING UX MOMENT IN PHASE 1 — verbatim copy is intentional and
 * the click-through gate is the only exit. Escape must NOT dismiss the
 * modal.
 */
const VERBATIM_FRAGMENT =
  "Heads up: enabling Linear's AgentSession category modifies the workspace UI";
const FULL_PARAGRAPH_1 =
  "Heads up: enabling Linear's AgentSession category modifies the workspace UI for every member of your Linear workspace, not just you.";
const BUTTON_LABEL = "I've notified my team";

test.describe('Setup wizard — AgentSession warning gate (SETUP-02)', () => {
  test('renders verbatim D-13 copy and the click-through button', async ({ page }) => {
    await page.goto('/setup/agentsession-warning');
    // Modal is auto-opened on mount.
    await expect(page.getByRole('alertdialog')).toBeVisible();
    // Verbatim opening fragment.
    await expect(page.getByRole('alertdialog')).toContainText(VERBATIM_FRAGMENT);
    // Verbatim full paragraph 1.
    await expect(page.getByRole('alertdialog')).toContainText(FULL_PARAGRAPH_1);
    // Click-through button label is verbatim.
    await expect(page.getByRole('button', { name: BUTTON_LABEL })).toBeVisible();
  });

  test('Escape does NOT dismiss the warning modal', async ({ page }) => {
    await page.goto('/setup/agentsession-warning');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    // Modal must still be open + verbatim copy still visible.
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toContainText(VERBATIM_FRAGMENT);
  });

  test("clicking 'I've notified my team' advances to Linear OAuth step", async ({ page }) => {
    await page.goto('/setup/agentsession-warning');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: BUTTON_LABEL }).click();
    await page.waitForURL(/\/setup\/linear-oauth/);
    await expect(page).toHaveURL(/\/setup\/linear-oauth/);
    await expect(
      page.getByRole('heading', { name: 'Connect your Linear workspace.' }),
    ).toBeVisible();
  });
});

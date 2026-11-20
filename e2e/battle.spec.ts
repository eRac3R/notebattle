import { expect, test, devices, type Page } from "@playwright/test";

/** Waits for enter animations to settle so README screenshots aren't mid-fade. */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(900);
  // Live runs keep their screenshots out of the README gallery.
  const dir = process.env.E2E_BASE_URL ? "test-results/live-screens" : "docs/screens";
  await page.screenshot({ path: `${dir}/${name}.png` });
};

test("host generates a deck from notes and three phones battle to the end", async ({ browser }) => {
  // Host on a laptop/projector.
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = await hostCtx.newPage();
  await host.goto("/");
  await shot(host, "01-landing");
  await host.getByRole("button", { name: /Create from my notes/ }).click();
  await host.getByRole("button", { name: "5", exact: true }).click();
  await expect(host.getByText("Game server online")).toBeVisible({ timeout: 120_000 });
  await host.getByRole("button", { name: /Try sample OS notes/ }).click();
  await expect(host.getByText("Quality gate")).toBeVisible();
  // Live: the free server may need ~1 min to wake, and real LLM generation takes longer.
  await expect(host.getByRole("heading", { name: "Review before you battle" })).toBeVisible({ timeout: 150_000 });
  await shot(host, "02-review");
  await host.getByRole("button", { name: /Open room with 5 questions/ }).click();
  await host.waitForURL(/\/host\/[A-Z0-9]{6}$/);
  const code = host.url().split("/").pop()!;

  // Three players on phones.
  const names = ["Riya", "Arjun", "Meera"];
  const players: Page[] = [];
  for (const name of names) {
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const p = await ctx.newPage();
    await p.goto(`/play/${code}`);
    await p.getByLabel("Nickname").fill(name);
    await p.getByRole("button", { name: "Join battle" }).click();
    await expect(p.getByRole("heading", { name: "You're in!" })).toBeVisible();
    players.push(p);
  }
  await expect(host.getByRole("heading", { name: "3 players in" })).toBeVisible();
  await shot(host, "03-lobby");

  await host.getByRole("button", { name: /Start battle/ }).click();
  for (let q = 0; q < 5; q++) {
    for (const [i, p] of players.entries()) {
      await expect(p.getByText(`Question ${q + 1}/5`)).toBeVisible();
      if (q === 0 && i === 0) await shot(p, "04-phone-question");
      // Players can't know the answer from the UI (by design), so each just picks a letter.
      await p.locator("main button").nth(i).click();
    }
    if (q === 0) await shot(host, "05-host-question-or-reveal");
    await expect(host.getByText("got it right")).toBeVisible();
    if (q === 0) {
      await shot(host, "06-reveal-with-receipt");
      await shot(players[0]!, "07-phone-result");
    }
    await host.getByRole("button", { name: /Scoreboard/ }).click();
    await expect(host.getByRole("heading", { name: "Scoreboard" })).toBeVisible();
    await host.getByRole("button", { name: q === 4 ? /Final results/ : /Next question/ }).click();
  }

  await expect(host.getByRole("heading", { name: "Final results" })).toBeVisible();
  await expect(host.getByText("What the room should revise")).toBeVisible();
  const share = host.getByRole("link", { name: /Share results/ });
  await expect(share).toBeVisible({ timeout: 10_000 });
  await host.waitForTimeout(1500); // podium springs in last
  await shot(host, "08-final");
  for (const p of players) await expect(p.getByText(/of 3/).first()).toBeVisible();

  const results = await hostCtx.newPage();
  await results.goto((await share.getAttribute("href"))!);
  await expect(results.getByRole("row")).toHaveCount(4); // header + 3 players
  await shot(results, "09-results-page");
});

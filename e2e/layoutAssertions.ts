import { expect, type Page } from "@playwright/test";

export async function expectFolderAttached(page: Page, placement: "top" | "bottom") {
  const panel = page.locator(".folder-popover");
  const anchor = page.locator(".bookmark-cell-wrap.active > .bookmark-cell");
  await expect(panel).toBeVisible();
  await expect
    .poll(async () => {
      const button = (await anchor.boundingBox())!;
      const popup = (await panel.boundingBox())!;
      return Math.abs(placement === "bottom" ? popup.y - (button.y + button.height) : button.y - (popup.y + popup.height));
    })
    .toBeLessThanOrEqual(0.5);
  const button = (await anchor.boundingBox())!;
  const popup = (await panel.boundingBox())!;
  expect(Math.abs(popup.width - button.width)).toBeLessThanOrEqual(0.5);
  expect(popup.y).toBeGreaterThanOrEqual(0);
  expect(popup.y + popup.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

export async function expectNotesSortContained(page: Page) {
  const sidebar = (await page.locator(".notes-sidebar").boundingBox())!;
  const heading = (await page.getByRole("heading", { name: "Notes", exact: true }).boundingBox())!;
  const label = (await page.locator(".notes-sort-row > label").boundingBox())!;
  const group = page.getByRole("group", { name: "Sort notes" });
  await expect(group).toBeVisible();
  const bounds = (await group.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(heading.y + heading.height + 6);
  expect(Math.abs(label.y + label.height / 2 - (bounds.y + bounds.height / 2))).toBeLessThanOrEqual(0.5);
  const options = await group.getByRole("button").all();
  expect(options).toHaveLength(2);
  const optionBounds = await Promise.all(options.map(async (option) => (await option.boundingBox())!));
  for (const box of [label, bounds, ...optionBounds]) {
    expect(box.x).toBeGreaterThanOrEqual(sidebar.x);
    expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  }
  expect(bounds.width).toBe(132);
  const modified = optionBounds[0];
  const created = optionBounds[1];
  expect(modified.y).toBe(created.y);
  expect(created.x).toBeGreaterThanOrEqual(modified.x + modified.width);
  expect(modified.width).toBe(64);
  expect(created.width).toBe(64);
  expect(await group.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
}

export async function expectNotesMetadataVisible(page: Page) {
  const footer = page.locator(".notes-statusbar");
  await expect(footer).toBeVisible();
  await expect(footer.locator(".notes-stats")).toContainText(/Lines: \d+[\s\S]*Characters: \d+[\s\S]*Size:/);
  await expect(footer.locator(".notes-meta")).toContainText(
    /Last edited: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[\s\S]*Created: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
  );
  const clipping = await footer.evaluate((node) => {
    const footerBounds = node.getBoundingClientRect();
    const dialog = node.closest(".notes-window")!.getBoundingClientRect();
    const editor = node.parentElement!.querySelector(".notes-editor")!.getBoundingClientRect();
    const fields = [...node.querySelectorAll(".notes-stats, .notes-meta")];
    return {
      fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
      contained: footerBounds.left >= dialog.left && footerBounds.right <= dialog.right && footerBounds.bottom <= Math.min(dialog.bottom, innerHeight),
      belowEditor: footerBounds.top >= editor.bottom,
      overflow: fields.map((field) => field.scrollWidth - field.clientWidth),
      textContained: fields.every((field) => {
        const range = document.createRange();
        range.selectNodeContents(field);
        return [...range.getClientRects()].every(
          (rect) =>
            rect.left >= footerBounds.left - 0.5 &&
            rect.right <= footerBounds.right + 0.5 &&
            rect.top >= footerBounds.top - 0.5 &&
            rect.bottom <= footerBounds.bottom + 0.5
        );
      })
    };
  });
  expect(clipping.fontSize, "Metadata must remain legible").toBeGreaterThanOrEqual(10);
  expect(clipping.contained, "Metadata must remain inside the Notes window and viewport").toBe(true);
  expect(clipping.belowEditor, "The editor must leave room for metadata").toBe(true);
  for (const overflow of clipping.overflow) expect(overflow, "Metadata must not be ellipsized or clipped").toBeLessThanOrEqual(1);
  expect(clipping.textContained, "Every metadata text fragment must be visible").toBe(true);
}

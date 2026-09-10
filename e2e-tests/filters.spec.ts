import { test, expect, type Page, type Locator } from '@playwright/test';

/** Cards currently visible in the grid (the filter script hides non-matches). */
function visibleCards(page: Page): Locator {
  return page.getByTestId('game-card').filter({ visible: true });
}

async function categorySlugsOf(cards: Locator): Promise<string[]> {
  return cards.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.categorySlug ?? ''),
  );
}

async function publisherSlugsOf(cards: Locator): Promise<string[]> {
  return cards.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.publisherSlug ?? ''),
  );
}

test.describe('Game Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('filter-panel')).toBeVisible();
  });

  test('Filters - panel renders category and publisher groups', async ({ page }) => {
    await test.step('Verify both filter groups are present', async () => {
      await expect(page.getByRole('group', { name: 'Category' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Publisher' })).toBeVisible();
    });

    await test.step('Verify known filter options are offered as checkboxes', async () => {
      await expect(page.getByRole('checkbox', { name: 'Strategy' })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'GitHub Games' })).not.toBeChecked();
    });

    await test.step('Verify the initial result count reflects every game', async () => {
      const total = await page.getByTestId('game-card').count();
      await expect(page.getByTestId('filter-result-count')).toHaveText(
        `Showing ${total} of ${total} games`,
      );
    });
  });

  test('Filters - selecting a category narrows the grid', async ({ page }) => {
    const allCount = await page.getByTestId('game-card').count();

    await page.getByTestId('filter-category-strategy').check();

    await expect
      .poll(async () => (await categorySlugsOf(visibleCards(page))).every((slug) => slug === 'strategy'))
      .toBe(true);

    const shownCount = await visibleCards(page).count();
    expect(shownCount).toBeGreaterThan(0);
    expect(shownCount).toBeLessThan(allCount);
    await expect(page.getByTestId('filter-result-count')).toHaveText(
      `Showing ${shownCount} of ${allCount} games`,
    );
  });

  test('Filters - selecting multiple categories ORs them together', async ({ page }) => {
    await page.getByTestId('filter-category-strategy').check();
    const strategyOnly = await visibleCards(page).count();

    await page.getByTestId('filter-category-puzzle').check();

    await expect
      .poll(async () => visibleCards(page).count())
      .toBeGreaterThan(strategyOnly);

    const slugs = await categorySlugsOf(visibleCards(page));
    expect(new Set(slugs)).toEqual(new Set(['strategy', 'puzzle']));
  });

  test('Filters - selecting a publisher narrows the grid', async ({ page }) => {
    await page.getByTestId('filter-publisher-github-games').check();

    await expect
      .poll(async () =>
        (await publisherSlugsOf(visibleCards(page))).every((slug) => slug === 'github-games'),
      )
      .toBe(true);

    expect(await visibleCards(page).count()).toBeGreaterThan(0);
  });

  test('Filters - category and publisher filters combine with AND', async ({ page }) => {
    await page.getByTestId('filter-category-strategy').check();
    await page.getByTestId('filter-publisher-github-games').check();

    await expect
      .poll(async () => {
        const cards = visibleCards(page);
        const categories = await categorySlugsOf(cards);
        const publishers = await publisherSlugsOf(cards);
        return (
          categories.every((slug) => slug === 'strategy') &&
          publishers.every((slug) => slug === 'github-games')
        );
      })
      .toBe(true);
  });

  test('Filters - selection is reflected in the URL', async ({ page }) => {
    await page.getByTestId('filter-category-strategy').check();
    await expect(page).toHaveURL(/[?&]category=strategy/);

    await page.getByTestId('filter-publisher-github-games').check();
    await expect(page).toHaveURL(/[?&]publisher=github-games/);
  });

  test('Filters - loading a filtered URL applies the filters', async ({ page }) => {
    await page.goto('/?category=puzzle&publisher=github-games');

    await expect(page.getByTestId('filter-category-puzzle')).toBeChecked();
    await expect(page.getByTestId('filter-publisher-github-games')).toBeChecked();
    await expect(page.getByTestId('filter-category-strategy')).not.toBeChecked();

    const categories = await categorySlugsOf(visibleCards(page));
    expect(categories.every((slug) => slug === 'puzzle')).toBe(true);
  });

  test('Filters - clear button restores the full list', async ({ page }) => {
    const allCount = await page.getByTestId('game-card').count();

    await page.getByTestId('filter-category-strategy').check();
    await expect.poll(async () => visibleCards(page).count()).toBeLessThan(allCount);

    await page.getByTestId('filter-clear').click();

    await expect(page.getByTestId('filter-category-strategy')).not.toBeChecked();
    await expect(page.getByTestId('filter-result-count')).toHaveText(
      `Showing ${allCount} of ${allCount} games`,
    );
    expect(await visibleCards(page).count()).toBe(allCount);
  });

  test('Filters - empty state shows when no games match', async ({ page }) => {
    await page.getByTestId('filter-category-strategy').evaluate((input) => {
      (input as HTMLInputElement).value = 'no-such-category';
    });
    await page.getByTestId('filter-category-strategy').check();

    await expect(page.getByTestId('no-results')).toBeVisible();
    await expect(page.getByTestId('empty-state-text')).toHaveText(
      'No games match the selected filters.',
    );
    await expect(page.getByTestId('games-grid')).toBeHidden();
    await expect(page.getByTestId('filter-result-count')).toContainText('Showing 0 of');
  });

  test('Filters - clearing an empty result restores the grid', async ({ page }) => {
    const allCount = await page.getByTestId('game-card').count();
    await page.getByTestId('filter-category-strategy').evaluate((input) => {
      (input as HTMLInputElement).value = 'no-such-category';
    });
    await page.getByTestId('filter-category-strategy').check();
    await expect(page.getByTestId('no-results')).toBeVisible();

    await page.getByTestId('filter-clear').click();

    await expect(page.getByTestId('games-grid')).toBeVisible();
    await expect(page.getByTestId('no-results')).toBeHidden();
    await expect(page.getByTestId('filter-result-count')).toHaveText(
      `Showing ${allCount} of ${allCount} games`,
    );
  });
});

test.describe('Prerendered Filter Routes', () => {
  test('Static category route renders a pre-filtered grid', async ({ page }) => {
    await page.goto('/games/category/strategy/');

    await expect(page).toHaveTitle('Strategy Games - Tailspin Toys');
    await expect(page.getByRole('heading', { name: 'Strategy games', level: 1 })).toBeVisible();

    const cards = page.getByTestId('game-card');
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first().getByTestId('game-category')).toHaveText('Strategy');
  });

  test('Static publisher route renders a pre-filtered grid', async ({ page }) => {
    await page.goto('/games/publisher/github-games/');

    await expect(page).toHaveTitle('Games by GitHub Games - Tailspin Toys');
    await expect(page.getByRole('heading', { name: 'Games by GitHub Games', level: 1 })).toBeVisible();

    const cards = page.getByTestId('game-card');
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first().getByTestId('game-publisher')).toHaveText('GitHub Games');
  });

  test('Static filter route links back to the full listing', async ({ page }) => {
    await page.goto('/games/category/puzzle/');
    await page.getByTestId('back-to-all-games').click();

    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('games-grid')).toBeVisible();
  });
});

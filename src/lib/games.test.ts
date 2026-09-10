import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGameById,
    getGames,
    getAllCategories,
    getAllPublishers,
    type GameFilters,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

interface FilterFixture {
    categoryIds: Record<'strategy' | 'puzzle' | 'action', number>;
    publisherIds: Record<'alpha' | 'beta', number>;
}

/**
 * Seed a small matrix covering both category and publisher combinations so filter
 * behaviour (OR within a group, AND across groups) can be asserted precisely.
 */
async function seedFilterMatrix(db: Database): Promise<FilterFixture> {
    const categoryIds = {} as FilterFixture['categoryIds'];
    for (const [key, name] of [
        ['strategy', 'Strategy'],
        ['puzzle', 'Puzzle'],
        ['action', 'Action'],
    ] as const) {
        const [row] = await db.insert(categories).values({ name }).returning({ id: categories.id });
        categoryIds[key] = row.id;
    }

    const publisherIds = {} as FilterFixture['publisherIds'];
    for (const [key, name] of [
        ['alpha', 'Alpha Games'],
        ['beta', 'Beta Interactive'],
    ] as const) {
        const [row] = await db.insert(publishers).values({ name }).returning({ id: publishers.id });
        publisherIds[key] = row.id;
    }

    const rows: Array<{ title: string; categoryId: number; publisherId: number }> = [
        { title: 'Zulu Strategy', categoryId: categoryIds.strategy, publisherId: publisherIds.alpha },
        { title: 'Alpha Strategy', categoryId: categoryIds.strategy, publisherId: publisherIds.beta },
        { title: 'Puzzle Quest', categoryId: categoryIds.puzzle, publisherId: publisherIds.alpha },
        { title: 'Action Rush', categoryId: categoryIds.action, publisherId: publisherIds.beta },
    ];

    for (const row of rows) {
        await db.insert(games).values({
            ...row,
            description: `${row.title} description`,
            starRating: 4,
        });
    }

    return { categoryIds, publisherIds };
}

async function titlesFor(db: Database, filters: GameFilters): Promise<string[]> {
    const results = await getGames(db, filters);
    return results.map((game) => game.title);
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });

    it('returns an empty list when there are no games', async () => {
        expect(await getAllGames(db)).toEqual([]);
    });
});

describe('getGames filtering', () => {
    let db: Database;
    let fixture: FilterFixture;

    beforeEach(async () => {
        db = await createTestDatabase();
        fixture = await seedFilterMatrix(db);
    });

    it('returns every game ordered by title when no filters are supplied', async () => {
        expect(await titlesFor(db, {})).toEqual([
            'Action Rush',
            'Alpha Strategy',
            'Puzzle Quest',
            'Zulu Strategy',
        ]);
    });

    it('treats empty filter arrays as no constraint', async () => {
        expect(await titlesFor(db, { categoryIds: [], publisherIds: [] })).toHaveLength(4);
    });

    it('filters by a single category', async () => {
        expect(await titlesFor(db, { categoryIds: [fixture.categoryIds.strategy] })).toEqual([
            'Alpha Strategy',
            'Zulu Strategy',
        ]);
    });

    it('ORs multiple categories together', async () => {
        const titles = await titlesFor(db, {
            categoryIds: [fixture.categoryIds.strategy, fixture.categoryIds.puzzle],
        });
        expect(titles).toEqual(['Alpha Strategy', 'Puzzle Quest', 'Zulu Strategy']);
    });

    it('filters by a single publisher', async () => {
        expect(await titlesFor(db, { publisherIds: [fixture.publisherIds.alpha] })).toEqual([
            'Puzzle Quest',
            'Zulu Strategy',
        ]);
    });

    it('ORs multiple publishers together', async () => {
        const titles = await titlesFor(db, {
            publisherIds: [fixture.publisherIds.alpha, fixture.publisherIds.beta],
        });
        expect(titles).toHaveLength(4);
    });

    it('ANDs category and publisher filters together', async () => {
        expect(
            await titlesFor(db, {
                categoryIds: [fixture.categoryIds.strategy],
                publisherIds: [fixture.publisherIds.beta],
            }),
        ).toEqual(['Alpha Strategy']);
    });

    it('returns an empty list when the combination matches nothing', async () => {
        expect(
            await titlesFor(db, {
                categoryIds: [fixture.categoryIds.puzzle],
                publisherIds: [fixture.publisherIds.beta],
            }),
        ).toEqual([]);
    });

    it('returns an empty list for unknown ids', async () => {
        expect(await titlesFor(db, { categoryIds: [99999] })).toEqual([]);
    });

    it('resolves relations on filtered results', async () => {
        const [game] = await getGames(db, { categoryIds: [fixture.categoryIds.action] });
        expect(game.category).toEqual({ id: fixture.categoryIds.action, name: 'Action' });
        expect(game.publisher).toEqual({ id: fixture.publisherIds.beta, name: 'Beta Interactive' });
    });
});

describe('filter option helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns categories ordered by name', async () => {
        await seedFilterMatrix(db);
        expect((await getAllCategories(db)).map((c) => c.name)).toEqual([
            'Action',
            'Puzzle',
            'Strategy',
        ]);
    });

    it('returns publishers ordered by name', async () => {
        await seedFilterMatrix(db);
        expect((await getAllPublishers(db)).map((p) => p.name)).toEqual([
            'Alpha Games',
            'Beta Interactive',
        ]);
    });

    it('returns empty lists when nothing is seeded', async () => {
        expect(await getAllCategories(db)).toEqual([]);
        expect(await getAllPublishers(db)).toEqual([]);
    });
});

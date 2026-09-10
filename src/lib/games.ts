import { eq, asc, and, inArray, type SQL } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game, Category, Publisher } from '../types/game';

/** Filter criteria for {@link getGames}. Groups are ORed internally and ANDed together. */
export interface GameFilters {
    /** Restrict to games in any of these category ids. Omitted or empty means no constraint. */
    categoryIds?: number[];
    /** Restrict to games from any of these publisher ids. Omitted or empty means no constraint. */
    publisherIds?: number[];
}

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

/**
 * Games matching the supplied filters, ordered by title.
 *
 * @param db - Drizzle database client to query.
 * @param filters - Optional category/publisher restrictions. Empty arrays are ignored so
 * callers can pass a partially-populated selection without special-casing it.
 * @returns The matching games with their category and publisher relations resolved.
 */
export async function getGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    const conditions: SQL[] = [];

    if (filters.categoryIds && filters.categoryIds.length > 0) {
        conditions.push(inArray(games.categoryId, filters.categoryIds));
    }
    if (filters.publisherIds && filters.publisherIds.length > 0) {
        conditions.push(inArray(games.publisherId, filters.publisherIds));
    }

    const query = baseGamesQuery(db);
    const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;
    const rows = await filtered.orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * All games ordered by title.
 *
 * @param db - Drizzle database client to query.
 * @returns Every game with its category and publisher relations resolved.
 */
export async function getAllGames(db: Database): Promise<Game[]> {
    return getGames(db);
}

/**
 * All categories ordered by name, used to build filter controls and static filter routes.
 *
 * @param db - Drizzle database client to query.
 * @returns Every category in alphabetical order.
 */
export async function getAllCategories(db: Database): Promise<Category[]> {
    return db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name));
}

/**
 * All publishers ordered by name, used to build filter controls and static filter routes.
 *
 * @param db - Drizzle database client to query.
 * @returns Every publisher in alphabetical order.
 */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    return db
        .select({ id: publishers.id, name: publishers.name })
        .from(publishers)
        .orderBy(asc(publishers.name));
}

/**
 * All game ids ordered by title.
 *
 * @param db - Drizzle database client to query.
 * @returns Game ids in alphabetical title order.
 */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * A single game by id.
 *
 * @param db - Drizzle database client to query.
 * @param id - Game id to look up.
 * @returns The game, or `null` when no game with that id exists.
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}

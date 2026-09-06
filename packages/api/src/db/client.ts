import pg from 'pg';

/**
 * One pool for the process. Kept deliberately thin — the memory engine and
 * routes speak SQL directly, because a query builder would hide exactly the
 * vector and time-window queries that make this app work.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
});

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}

/** pgvector wants the literal '[0.1,0.2,...]' text form. */
export function vec(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

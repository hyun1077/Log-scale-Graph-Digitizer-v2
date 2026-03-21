import { neon } from '@neondatabase/serverless';

function getDb() {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.hyun_DATABASE_URL ||
    process.env.hyun_POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL/POSTGRES_URL is not set');
  return neon(url);
}

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id            TEXT PRIMARY KEY,
      company       TEXT NOT NULL,
      name          TEXT NOT NULL,
      saved_at      TIMESTAMPTZ DEFAULT NOW(),
      series_name   TEXT,
      series_color  TEXT,
      points        JSONB DEFAULT '[]',
      image_data    TEXT,
      bg_xform      JSONB,
      custom_anchor JSONB,
      min_break_current FLOAT
    )
  `;
}

function rowToProduct(r, includeImage = false) {
  return {
    id:               r.id,
    company:          r.company,
    name:             r.name,
    savedAt:          r.saved_at,
    seriesName:       r.series_name,
    seriesColor:      r.series_color,
    points:           r.points ?? [],
    bgXform:          r.bg_xform,
    customAnchor:     r.custom_anchor,
    minBreakCurrent:  r.min_break_current,
    ...(includeImage ? { imageData: r.image_data } : {}),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getDb();
    await ensureTable(sql);

    /* GET /api/products — list (no imageData) */
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, company, name, saved_at, series_name, series_color,
               points, bg_xform, custom_anchor, min_break_current
        FROM products ORDER BY saved_at DESC
      `;
      return res.json(rows.map(r => rowToProduct(r, false)));
    }

    /* POST /api/products — save */
    if (req.method === 'POST') {
      const b = req.body;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const pointsJson  = JSON.stringify(b.points ?? []);
      const bgXformJson = JSON.stringify(b.bgXform ?? {});
      const anchorJson  = b.customAnchor ? JSON.stringify(b.customAnchor) : null;

      const existing = await sql`
        SELECT id FROM products WHERE company = ${b.company} AND name = ${b.name}
      `;

      if (existing.length > 0) {
        await sql`
          UPDATE products SET
            saved_at          = NOW(),
            series_name       = ${b.seriesName ?? null},
            series_color      = ${b.seriesColor ?? null},
            points            = ${pointsJson}::jsonb,
            image_data        = ${b.imageData ?? null},
            bg_xform          = ${bgXformJson}::jsonb,
            custom_anchor     = ${anchorJson}::jsonb,
            min_break_current = ${b.minBreakCurrent ?? null}
          WHERE company = ${b.company} AND name = ${b.name}
        `;
        return res.json({ id: existing[0].id });
      } else {
        await sql`
          INSERT INTO products
            (id, company, name, series_name, series_color, points,
             image_data, bg_xform, custom_anchor, min_break_current)
          VALUES (
            ${id}, ${b.company}, ${b.name},
            ${b.seriesName ?? null}, ${b.seriesColor ?? null},
            ${pointsJson}::jsonb,
            ${b.imageData ?? null},
            ${bgXformJson}::jsonb,
            ${anchorJson}::jsonb,
            ${b.minBreakCurrent ?? null}
          )
        `;
        return res.json({ id });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

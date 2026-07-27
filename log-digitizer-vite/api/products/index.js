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

const ADMIN_AUTH = 'c2lub2Z1c2U6MjAyMyEh';
const isAdmin = req => req.headers['x-admin-auth'] === ADMIN_AUTH;

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
      image_settings JSONB,
      min_break_current FLOAT,
      source_slot   INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS source_slot INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_settings JSONB`;
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
    imageSettings:    r.image_settings,
    minBreakCurrent:  r.min_break_current,
    sourceSlot:       r.source_slot != null && r.source_slot !== '' ? Number(r.source_slot) : undefined,
    ...(includeImage ? { imageData: r.image_data } : {}),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Auth');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getDb();
    await ensureTable(sql);

    /* GET /api/products — list (no imageData) */
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, company, name, saved_at, series_name, series_color,
               points, bg_xform, custom_anchor, image_settings, min_break_current, source_slot
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
      const imageSettingsJson = b.imageSettings ? JSON.stringify(b.imageSettings) : null;
      const rawSlot = Number(b.sourceSlot);
      const sourceSlot =
        Number.isFinite(rawSlot) && rawSlot >= 0 && rawSlot < 20 ? Math.floor(rawSlot) : 0;

      const existing = await sql`
        SELECT id FROM products
        WHERE company = ${b.company} AND name = ${b.name} AND COALESCE(source_slot, 0) = ${sourceSlot}
      `;

      if (existing.length > 0) {
        if (!isAdmin(req)) return res.status(401).json({ error: 'Login required to overwrite a product' });
        await sql`
          UPDATE products SET
            saved_at          = NOW(),
            series_name       = ${b.seriesName ?? null},
            series_color      = ${b.seriesColor ?? null},
            points            = ${pointsJson}::jsonb,
            image_data        = ${b.imageData ?? null},
            bg_xform          = ${bgXformJson}::jsonb,
            custom_anchor     = ${anchorJson}::jsonb,
            image_settings    = ${imageSettingsJson}::jsonb,
            min_break_current = ${b.minBreakCurrent ?? null},
            source_slot       = ${sourceSlot}
          WHERE id = ${existing[0].id}
        `;
        return res.json({ id: existing[0].id });
      } else {
        await sql`
          INSERT INTO products
            (id, company, name, series_name, series_color, points,
             image_data, bg_xform, custom_anchor, image_settings, min_break_current, source_slot)
          VALUES (
            ${id}, ${b.company}, ${b.name},
            ${b.seriesName ?? null}, ${b.seriesColor ?? null},
            ${pointsJson}::jsonb,
            ${b.imageData ?? null},
            ${bgXformJson}::jsonb,
            ${anchorJson}::jsonb,
            ${imageSettingsJson}::jsonb,
            ${b.minBreakCurrent ?? null},
            ${sourceSlot}
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

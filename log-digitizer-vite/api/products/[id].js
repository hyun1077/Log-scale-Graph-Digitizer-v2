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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;

  try {
    const sql = getDb();

    /* GET /api/products/:id — full product including imageData */
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const r = rows[0];
      return res.json({
        id:               r.id,
        company:          r.company,
        name:             r.name,
        savedAt:          r.saved_at,
        seriesName:       r.series_name,
        seriesColor:      r.series_color,
        points:           r.points ?? [],
        imageData:        r.image_data,
        bgXform:          r.bg_xform,
        customAnchor:     r.custom_anchor,
        minBreakCurrent:  r.min_break_current,
      });
    }

    /* DELETE /api/products/:id */
    if (req.method === 'DELETE') {
      await sql`DELETE FROM products WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

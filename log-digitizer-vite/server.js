import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const DB_PATH = path.join(__dirname, 'products.json');

const app = express();
app.use(express.json({ limit: '150mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('DB read error:', e.message);
  }
  return [];
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/* List products — imageData excluded for bandwidth */
app.get('/api/products', (req, res) => {
  const items = loadDB();
  res.json(items.map(({ imageData, ...rest }) => rest));
});

/* Get single product with full imageData */
app.get('/api/products/:id', (req, res) => {
  const items = loadDB();
  const item = items.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

/* Save (create or overwrite by company+name) */
app.post('/api/products', (req, res) => {
  const items = loadDB();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const item = { id, savedAt: new Date().toISOString(), ...req.body };
  const slotOf = (p) => (p.sourceSlot != null && Number.isFinite(Number(p.sourceSlot)) ? Math.floor(Number(p.sourceSlot)) : 0);
  const existIdx = items.findIndex(
    p => p.company === item.company && p.name === item.name && slotOf(p) === slotOf(item)
  );
  if (existIdx >= 0) {
    items[existIdx] = { ...items[existIdx], ...item, id: items[existIdx].id };
  } else {
    items.push(item);
  }
  saveDB(items);
  res.json({ id: item.id });
});

/* Delete */
app.delete('/api/products/:id', (req, res) => {
  const items = loadDB();
  const idx = items.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  items.splice(idx, 1);
  saveDB(items);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\nProduct Library server  ->  http://localhost:${PORT}`);
  console.log(`DB file                 ->  ${DB_PATH}\n`);
});

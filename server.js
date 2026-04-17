const express = require('express');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const port = process.env.PORT || 3000;
const currentYear = new Date().getFullYear();
const dbPath = path.join(__dirname, 'data', 'database.sqlite');
const legacyCleanupId = 'clear-legacy-movies-2026-04-17';

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    director TEXT NOT NULL,
    year INTEGER NOT NULL,
    rating REAL NOT NULL,
    genre TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);

function runOneTimeLegacyCleanup() {
  const cleanupAlreadyApplied = db
    .prepare('SELECT 1 FROM app_migrations WHERE id = ?')
    .get(legacyCleanupId);

  if (cleanupAlreadyApplied) return;

  const cleanup = db.transaction(() => {
    const result = db.prepare('DELETE FROM movies').run();
    db.prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .run(legacyCleanupId, new Date().toISOString());
    return result.changes;
  });

  const deletedMovies = cleanup();
  console.log(`Limpeza inicial aplicada: ${deletedMovies} filme(s) legado(s) removido(s).`);
}

runOneTimeLegacyCleanup();

app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

function validateMovie(payload, partial = false) {
  const errors = [];
  const allowedFields = ['title', 'director', 'year', 'rating', 'genre'];
  const fieldLabels = {
    title: 'título',
    director: 'diretor',
    year: 'ano',
    rating: 'nota',
    genre: 'gênero'
  };
  const data = {};

  for (const field of allowedFields) {
    if (Object.hasOwn(payload, field)) data[field] = payload[field];
  }

  if (!partial) {
    for (const field of allowedFields) {
      if (!Object.hasOwn(data, field)) errors.push(`${fieldLabels[field]} é obrigatório.`);
    }
  }

  for (const field of ['title', 'director', 'genre']) {
    if (Object.hasOwn(data, field)) {
      if (typeof data[field] !== 'string' || data[field].trim() === '') {
        errors.push(`${fieldLabels[field]} deve ser um texto não vazio.`);
      } else {
        data[field] = data[field].trim();
      }
    }
  }

  if (Object.hasOwn(data, 'year')) {
    const year = Number(data.year);
    if (!Number.isInteger(year) || year < 1888 || year > currentYear + 5) {
      errors.push(`ano deve ser um número inteiro entre 1888 e ${currentYear + 5}.`);
    } else {
      data.year = year;
    }
  }

  if (Object.hasOwn(data, 'rating')) {
    const rating = Number(data.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      errors.push('nota deve ser um número entre 1 e 5.');
    } else {
      data.rating = Math.round(rating * 10) / 10;
    }
  }

  if (partial && Object.keys(data).length === 0) {
    errors.push('Pelo menos um campo editável do filme é obrigatório.');
  }

  return { data, errors };
}

function parsePositiveInteger(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

app.get('/api/movies', (req, res) => {
  const { genre, sortBy = 'title', order = 'asc' } = req.query;
  const searchFilter = String(req.query.search || '').trim();
  const limit = parsePositiveInteger(req.query.limit, 10);
  const page = parsePositiveInteger(req.query.page, 1, 100000);
  const offset = (page - 1) * limit;
  const sortableFields = new Set(['title', 'director', 'year', 'rating', 'genre']);
  const safeSortBy = sortableFields.has(sortBy) ? sortBy : 'title';
  const safeOrder = String(order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const where = [];
  const params = { limit, offset };

  if (genre && String(genre).trim()) {
    where.push('LOWER(genre) = LOWER(@genre)');
    params.genre = String(genre).trim();
  }

  if (searchFilter) {
    where.push('(LOWER(title) LIKE LOWER(@search) OR LOWER(genre) LIKE LOWER(@search))');
    params.search = `%${searchFilter}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS total FROM movies ${whereSql}`).get(params).total;
  const movies = db.prepare(`
    SELECT id, title, director, year, rating, genre
    FROM movies
    ${whereSql}
    ORDER BY ${safeSortBy} ${safeOrder}, title ASC
    LIMIT @limit OFFSET @offset
  `).all(params);

  res.status(200).json({
    data: movies,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
});

app.get('/api/movies/search', (req, res) => {
  const query = String(req.query.q || '').trim();

  if (!query) {
    return res.status(400).json({ errors: ['ParÃ¢metro q Ã© obrigatÃ³rio.'] });
  }

  const movies = db.prepare(`
    SELECT id, title, director, year, rating, genre
    FROM movies
    WHERE LOWER(title) LIKE LOWER(@query)
      OR LOWER(director) LIKE LOWER(@query)
      OR LOWER(genre) LIKE LOWER(@query)
    ORDER BY title ASC
  `).all({ query: `%${query}%` });

  return res.status(200).json({ data: movies });
});

app.get('/api/movies/:id', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Filme não encontrado.' });
  return res.status(200).json(movie);
});

app.post('/api/movies', (req, res) => {
  const { data, errors } = validateMovie(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const movie = { id: randomUUID(), ...data };
  db.prepare(`
    INSERT INTO movies (id, title, director, year, rating, genre)
    VALUES (@id, @title, @director, @year, @rating, @genre)
  `).run(movie);

  return res.status(201).json(movie);
});

app.put('/api/movies/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Filme não encontrado.' });

  const { data, errors } = validateMovie(req.body, true);
  if (errors.length) return res.status(400).json({ errors });

  const updated = { ...existing, ...data };
  db.prepare(`
    UPDATE movies
    SET title = @title, director = @director, year = @year, rating = @rating, genre = @genre
    WHERE id = @id
  `).run(updated);

  return res.status(200).json(updated);
});

app.delete('/api/movies/:id', (req, res) => {
  const result = db.prepare('DELETE FROM movies WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Filme não encontrado.' });
  return res.status(204).send();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.listen(port, () => {
    console.log(`Sistema de Gerenciamento de Filmes em execução em http://localhost:${port}`);
});

module.exports = app;

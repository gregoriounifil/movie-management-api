const express = require('express');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const port = process.env.PORT || 3000;
const currentYear = new Date().getFullYear();
const isVercel = Boolean(process.env.VERCEL);
const dbPath = isVercel
  ? '/tmp/database.sqlite'
  : path.join(process.cwd(), 'db', 'database.db');

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

app.use(express.json());
app.use(express.static(__dirname));

function validateMovie(payload, partial = false) {
  const errors = [];
  const allowedFields = ['title', 'director', 'year', 'rating', 'genre'];
  const data = {};

  for (const field of allowedFields) {
    if (Object.hasOwn(payload, field)) data[field] = payload[field];
  }

  if (!partial) {
    for (const field of allowedFields) {
      if (!Object.hasOwn(data, field)) errors.push(`${field} is required.`);
    }
  }

  for (const field of ['title', 'director', 'genre']) {
    if (Object.hasOwn(data, field)) {
      if (typeof data[field] !== 'string' || data[field].trim() === '') {
        errors.push(`${field} must be a non-empty string.`);
      } else {
        data[field] = data[field].trim();
      }
    }
  }

  if (Object.hasOwn(data, 'year')) {
    const year = Number(data.year);
    if (!Number.isInteger(year) || year < 1888 || year > currentYear + 5) {
      errors.push(`year must be an integer between 1888 and ${currentYear + 5}.`);
    } else {
      data.year = year;
    }
  }

  if (Object.hasOwn(data, 'rating')) {
    const rating = Number(data.rating);
    if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
      errors.push('rating must be a number between 0 and 10.');
    } else {
      data.rating = Math.round(rating * 10) / 10;
    }
  }

  if (partial && Object.keys(data).length === 0) {
    errors.push('At least one editable movie field is required.');
  }

  return { data, errors };
}

function parsePositiveInteger(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function extractLetterboxdTitles(html) {
  const $ = cheerio.load(html);
  const titles = new Set();

  $('[data-film-name]').each((_, element) => {
    const title = $(element).attr('data-film-name');
    if (title && title.trim()) titles.add(title.trim());
  });

  $('.poster-container img[alt], .film-poster img[alt]').each((_, element) => {
    const title = $(element).attr('alt');
    if (title && title.trim()) titles.add(title.trim());
  });

  $('li.poster-container div.film-poster, div.poster').each((_, element) => {
    const title = $(element).attr('data-film-name') || $(element).attr('data-target-link')?.split('/film/')[1]?.split('/')[0];
    if (title && title.trim()) {
      titles.add(title.replaceAll('-', ' ').replace(/\b\w/g, char => char.toUpperCase()).trim());
    }
  });

  return [...titles];
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

app.get('/api/movies/:id', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found.' });
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

app.post('/api/movies/import', async (req, res) => {
  const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';

  if (!url) return res.status(400).json({ errors: ['url is required.'] });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ errors: ['url must be a valid URL.'] });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ errors: ['url must use http or https.'] });
  }

  try {
    const response = await axios.get(parsedUrl.href, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 MovieManagementSystem/1.0'
      }
    });
    const titles = extractLetterboxdTitles(response.data);

    if (titles.length === 0) {
      return res.status(400).json({ errors: ['No movie titles were found at that Letterboxd URL.'] });
    }

    const existingTitles = new Set(
      db.prepare('SELECT LOWER(title) AS title FROM movies').all().map(row => row.title)
    );
    const insert = db.prepare(`
      INSERT INTO movies (id, title, director, year, rating, genre)
      VALUES (@id, @title, @director, @year, @rating, @genre)
    `);
    const imported = [];

    const saveMovies = db.transaction(() => {
      for (const title of titles) {
        if (existingTitles.has(title.toLowerCase())) continue;

        const movie = {
          id: randomUUID(),
          title,
          director: 'Unknown',
          year: currentYear,
          rating: 5.0,
          genre: 'Imported'
        };
        insert.run(movie);
        imported.push(movie);
        existingTitles.add(title.toLowerCase());
      }
    });

    saveMovies();

    return res.status(201).json({
      importedCount: imported.length,
      skippedCount: titles.length - imported.length,
      data: imported
    });
  } catch (error) {
    return res.status(400).json({
      errors: [`Could not import from URL: ${error.response?.status ? `HTTP ${error.response.status}` : error.message}`]
    });
  }
});

app.put('/api/movies/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Movie not found.' });

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
  if (result.changes === 0) return res.status(404).json({ error: 'Movie not found.' });
  return res.status(204).send();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

if (!isVercel) {
  app.listen(port, () => {
    console.log(`Movie Management System running at http://localhost:${port}`);
  });
}

module.exports = app;

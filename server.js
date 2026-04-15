import express from 'express';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const currentYear = new Date().getFullYear();
const dbDir = path.join(process.cwd(), 'db');

fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'database.db'));
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

  const textMinimumLengths = {
    title: 1,
    director: 2,
    genre: 2
  };

  for (const field of ['title', 'director', 'genre']) {
    if (Object.hasOwn(data, field)) {
      if (typeof data[field] !== 'string') {
        errors.push(`${field} must be a string.`);
      } else {
        const sanitized = data[field]
          .replace(/[\u0000-\u001F\u007F]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const minimumLength = textMinimumLengths[field];

        if (sanitized.length < minimumLength) {
          errors.push(`${field} must be at least ${minimumLength} character${minimumLength === 1 ? '' : 's'} long.`);
        } else {
          data[field] = sanitized;
        }
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

  function cleanTitle(title) {
    return String(title || '')
      .replace(/^Poster for\s+/i, '')
      .replace(/\s+\(\d{4}\)$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function addTitle(title) {
    const cleaned = cleanTitle(title);
    if (cleaned) titles.add(cleaned);
  }

  function titleFromFilmUrl(url) {
    const match = String(url || '').match(/\/film\/([^/]+)\//);
    if (!match) return '';

    return match[1]
      .replaceAll('-', ' ')
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim();
  }

  $('[data-film-name]').each((_, element) => {
    addTitle($(element).attr('data-film-name'));
  });

  if (titles.size > 0) return [...titles];

  $('[data-film-slug]').each((_, element) => {
    addTitle(titleFromFilmUrl(`/film/${$(element).attr('data-film-slug')}/`));
  });

  if (titles.size > 0) return [...titles];

  [
    '.poster-container img[alt]',
    '.film-poster img[alt]',
    '.poster-list li img[alt]',
    '.poster-list .poster img[alt]',
    '.film-list img[alt]',
    'ul.poster-list li a[href*="/film/"] img[alt]'
  ].forEach(selector => {
    $(selector).each((_, element) => {
      addTitle($(element).attr('alt'));
    });
  });

  if (titles.size > 0) return [...titles];

  [
    'li.poster-container div.film-poster',
    'div.poster',
    '.poster-list li',
    '.film-poster'
  ].forEach(selector => {
    $(selector).each((_, element) => {
      addTitle(
        $(element).attr('data-film-name')
          || titleFromFilmUrl($(element).attr('data-target-link'))
          || titleFromFilmUrl($(element).attr('href'))
          || titleFromFilmUrl($(element).find('a[href*="/film/"]').first().attr('href'))
      );
    });
  });

  return [...titles];
}

async function fetchRenderedLetterboxdHtml(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.5'
    });
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    console.log(`Letterboxd import status: ${response?.status() ?? 'unknown'}`);

    await page.waitForSelector('.poster-container, .film-poster, .poster-list', {
      visible: true,
      timeout: 30000
    });

    return await page.content();
  } finally {
    await browser.close();
  }
}

app.get('/api/movies', (req, res) => {
  const { genre, sortBy = 'title', order = 'asc' } = req.query;
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

  const movie = { id: uuidv4(), ...data };
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
    const html = await fetchRenderedLetterboxdHtml(parsedUrl.href);
    const titles = extractLetterboxdTitles(html);

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
          id: uuidv4(),
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
      errors: [`Could not import from URL: ${error.message}`]
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

app.listen(port, () => {
  console.log(`Movie Management System running at http://localhost:${port}`);
});

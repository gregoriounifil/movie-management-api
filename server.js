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
const dbDir = path.join(__dirname, 'data');
const dbPath = path.join(dbDir, 'database.sqlite');
const legacyCleanupId = 'clear-legacy-movies-2026-04-17';
const browserUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const puppeteerLaunchOptions = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    `--user-agent=${browserUserAgent}`
  ]
};

fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    director TEXT NOT NULL,
    year INTEGER NOT NULL,
    rating REAL,
    genre TEXT NOT NULL
  );
`);

const ratingColumn = db.prepare('PRAGMA table_info(movies)').all().find(column => column.name === 'rating');
if (ratingColumn?.notnull) {
  db.exec(`
    CREATE TABLE movies_new (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      director TEXT NOT NULL,
      year INTEGER NOT NULL,
      rating REAL,
      genre TEXT NOT NULL
    );

    INSERT INTO movies_new (id, title, director, year, rating, genre)
    SELECT id, title, director, year, rating, genre
    FROM movies;

    DROP TABLE movies;
    ALTER TABLE movies_new RENAME TO movies;
  `);
}

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
  console.log(`Initial cleanup applied: ${deletedMovies} legacy movie(s) removed.`);
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
    if (data.rating === null || data.rating === '') {
      data.rating = null;
    } else {
    const rating = Number(data.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      errors.push('rating must be a number between 1 and 5.');
    } else {
      data.rating = Math.round(rating * 10) / 10;
    }
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

function extractLetterboxdMovies(html) {
  const $ = cheerio.load(html);
  const moviesByTitle = new Map();

  function cleanTitle(title) {
    return String(title || '')
      .replace(/^Poster for\s+/i, '')
      .replace(/\s+\(\d{4}\)$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseYear(value) {
    const yearMatch = String(value || '').match(/\((\d{4})\)\s*$/);
    const year = Number(yearMatch?.[1] || value);
    return Number.isInteger(year) && year >= 1888 && year <= currentYear + 5 ? year : currentYear;
  }

  function parseRating(value, className = '') {
    const ratingClassMatch = String(className || '').match(/\brated-(\d+)\b/);
    if (ratingClassMatch) {
      const classRating = Math.round((Number(ratingClassMatch[1]) / 2) * 10) / 10;
      return classRating >= 1 && classRating <= 5 ? classRating : null;
    }

    const ratingText = String(value || '').trim();
    if (!ratingText) return null;

    const profileFullStars = (ratingText.match(/\u2605/g) || []).length;
    const profileHalfStars = (ratingText.match(/\u00bd|\u00BD|1\/2/g) || []).length;

    if (profileFullStars > 0 || profileHalfStars > 0) {
      const profileRating = Math.round((profileFullStars + profileHalfStars * 0.5) * 10) / 10;
      return profileRating >= 1 && profileRating <= 5 ? profileRating : null;
    }

    return null;

    const fullStars = (ratingText.match(/★/g) || []).length;
    const halfStars = (ratingText.match(/½/g) || []).length;
    const numericMatch = ratingText.match(/(\d+(?:\.\d+)?)/);

    if (fullStars > 0 || halfStars > 0) {
      return Math.min(5, Math.round((fullStars + halfStars * 0.5) * 10) / 10);
    }

    if (numericMatch) {
      const numericRating = Number(numericMatch[1]);
      if (Number.isFinite(numericRating)) return Math.min(5, Math.round(numericRating * 10) / 10);
    }

    return null;
  }

  function addMovie(title, details = {}) {
    const cleaned = cleanTitle(title);
    if (!cleaned || moviesByTitle.has(cleaned.toLowerCase())) return;

    moviesByTitle.set(cleaned.toLowerCase(), {
      title: cleaned,
      year: parseYear(details.year),
      rating: parseRating(details.rating, details.ratingClass),
      url: details.url || ''
    });
  }

  function titleFromFilmUrl(url) {
    const match = String(url || '').match(/\/film\/([^/]+)\//);
    if (!match) return '';

    return match[1]
      .replaceAll('-', ' ')
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim();
  }

  $('[data-component-class="LazyPoster"][data-film-id], [data-film-id][data-item-name]').each((_, element) => {
    const item = $(element);
    const filmId = item.attr('data-film-id');
    const poster = item.find('.film-poster').addBack('.film-poster').first();
    const title = item.attr('data-item-name')
      || item.attr('data-item-full-display-name')
      || poster.attr('data-film-name')
      || poster.find('.frame').attr('data-original-title')
      || poster.find('img[alt]').attr('alt')
      || titleFromFilmUrl(item.attr('data-target-link'));
    const url = item.attr('data-target-link') || item.attr('data-item-link') || poster.find('a[href*="/film/"]').first().attr('href');
    const viewingData = filmId ? $(`[data-item-uid="film:${filmId}"]`) : $();

    addMovie(title, {
      year: item.attr('data-film-release-year') || poster.attr('data-film-release-year') || title,
      rating: viewingData.find('.rating').first().text(),
      ratingClass: viewingData.find('.rating').first().attr('class'),
      url
    });
  });

  if (moviesByTitle.size > 0) return [...moviesByTitle.values()];

  $('.poster-container, li.poster-container').each((_, element) => {
    const container = $(element);
    const poster = container.find('.film-poster').addBack('.film-poster').first();
    const title = poster.attr('data-film-name')
      || poster.attr('data-item-name')
      || container.attr('data-film-name')
      || container.find('[data-film-name]').first().attr('data-film-name')
      || titleFromFilmUrl(container.find('a[href*="/film/"]').first().attr('href'));
    const url = container.find('a[href*="/film/"]').first().attr('href')
      || poster.find('a[href*="/film/"]').first().attr('href');
    const rating = container.find('.rating').first().text()
      || container.next('.rating').text()
      || poster.find('.rating').first().text();

    addMovie(title, {
      year: poster.attr('data-film-release-year') || container.attr('data-film-release-year'),
      rating,
      ratingClass: container.find('.rating').first().attr('class') || poster.find('.rating').first().attr('class'),
      url
    });
  });

  if (moviesByTitle.size > 0) return [...moviesByTitle.values()];

  $('[data-film-name]').each((_, element) => {
    const item = $(element);
    addMovie(item.attr('data-film-name'), {
      year: item.attr('data-film-release-year'),
      rating: item.find('.rating').first().text() || item.closest('.poster-container').find('.rating').first().text(),
      ratingClass: item.find('.rating').first().attr('class') || item.closest('.poster-container').find('.rating').first().attr('class'),
      url: item.attr('data-target-link') || item.attr('data-item-link') || item.find('a[href*="/film/"]').first().attr('href')
    });
  });

  if (moviesByTitle.size > 0) return [...moviesByTitle.values()];

  $('[data-film-slug]').each((_, element) => {
    const item = $(element);
    addMovie(titleFromFilmUrl(`/film/${item.attr('data-film-slug')}/`), {
      year: item.attr('data-film-release-year'),
      rating: item.find('.rating').first().text() || item.closest('.poster-container').find('.rating').first().text(),
      ratingClass: item.find('.rating').first().attr('class') || item.closest('.poster-container').find('.rating').first().attr('class'),
      url: `/film/${item.attr('data-film-slug')}/`
    });
  });

  if (moviesByTitle.size > 0) return [...moviesByTitle.values()];

  [
    '.poster-container img[alt]',
    '.film-poster img[alt]',
    '.poster-list li img[alt]',
    '.poster-list .poster img[alt]',
    '.film-list img[alt]',
    'ul.poster-list li a[href*="/film/"] img[alt]'
  ].forEach(selector => {
    $(selector).each((_, element) => {
      const item = $(element);
      const container = item.closest('.poster-container');
      const poster = item.closest('.film-poster');
      addMovie(item.attr('alt'), {
        year: poster.attr('data-film-release-year') || container.find('.film-poster').first().attr('data-film-release-year'),
        rating: container.find('.rating').first().text(),
        ratingClass: container.find('.rating').first().attr('class'),
        url: container.find('a[href*="/film/"]').first().attr('href') || poster.find('a[href*="/film/"]').first().attr('href')
      });
    });
  });

  if (moviesByTitle.size > 0) return [...moviesByTitle.values()];

  [
    'li.poster-container div.film-poster',
    'div.poster',
    '.poster-list li',
    '.film-poster'
  ].forEach(selector => {
    $(selector).each((_, element) => {
      const item = $(element);
      const poster = item.find('.film-poster').addBack('.film-poster').first();
      addMovie(
        item.attr('data-film-name')
          || poster.attr('data-film-name')
          || titleFromFilmUrl(item.attr('data-target-link'))
          || titleFromFilmUrl(item.attr('href'))
          || titleFromFilmUrl(item.find('a[href*="/film/"]').first().attr('href')),
        {
          year: poster.attr('data-film-release-year') || item.attr('data-film-release-year'),
          rating: item.find('.rating').first().text(),
          ratingClass: item.find('.rating').first().attr('class'),
          url: item.attr('data-target-link') || item.attr('href') || item.find('a[href*="/film/"]').first().attr('href')
        }
      );
    });
  });

  return [...moviesByTitle.values()];
}

async function fetchLetterboxdMovieDetails(browser, movieUrl) {
  if (!movieUrl) return { director: 'Unknown', genre: 'Imported' };

  const url = new URL(movieUrl, 'https://letterboxd.com').href;
  const page = await browser.newPage();

  try {
    await page.setUserAgent(browserUserAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1'
    });
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    return await page.evaluate(() => {
      function uniqueTexts(selector) {
        return [...document.querySelectorAll(selector)]
          .map(element => element.textContent.trim())
          .filter(Boolean)
          .filter((value, index, values) => values.indexOf(value) === index);
      }

      const directors = uniqueTexts('a[href*="/director/"]');
      const genres = uniqueTexts('a[href*="/films/genre/"]');

      return {
        director: directors.join(', ') || 'Unknown',
        genre: genres[0] || 'Imported'
      };
    });
  } finally {
    await page.close();
  }
}

async function enrichLetterboxdMovies(movies) {
  const browser = await puppeteer.launch(puppeteerLaunchOptions);
  const detailsByUrl = new Map();

  try {
    for (const movie of movies) {
      if (!movie.url) {
        detailsByUrl.set(movie.url, { director: 'Unknown', genre: 'Imported' });
        continue;
      }

      if (!detailsByUrl.has(movie.url)) {
        detailsByUrl.set(movie.url, await fetchLetterboxdMovieDetails(browser, movie.url));
      }

      Object.assign(movie, detailsByUrl.get(movie.url));
    }
  } finally {
    await browser.close();
  }

  return movies;
}

async function fetchRenderedLetterboxdHtml(url) {
  const browser = await puppeteer.launch(puppeteerLaunchOptions);

  try {
    const page = await browser.newPage();
    await page.setUserAgent(browserUserAgent);
    await page.setViewport({ width: 1366, height: 900 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1'
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
  const titleFilter = String(req.query.title || req.query.nome || '').trim();
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

  if (titleFilter) {
    where.push('LOWER(title) LIKE LOWER(@title)');
    params.title = `%${titleFilter}%`;
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
    return res.status(400).json({ errors: ['q is required.'] });
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
    const movies = extractLetterboxdMovies(html);

    if (movies.length === 0) {
      return res.status(400).json({ errors: ['No movie titles were found at that Letterboxd URL.'] });
    }

    await enrichLetterboxdMovies(movies);

    const existingTitles = new Set(
      db.prepare('SELECT LOWER(title) AS title FROM movies').all().map(row => row.title)
    );
    const insert = db.prepare(`
      INSERT INTO movies (id, title, director, year, rating, genre)
      VALUES (@id, @title, @director, @year, @rating, @genre)
    `);
    const imported = [];

    const saveMovies = db.transaction(() => {
      for (const importedMovie of movies) {
        if (existingTitles.has(importedMovie.title.toLowerCase())) continue;

        const movie = {
          id: uuidv4(),
          title: importedMovie.title,
          director: importedMovie.director,
          year: importedMovie.year,
          rating: importedMovie.rating,
          genre: importedMovie.genre
        };
        insert.run(movie);
        imported.push(movie);
        existingTitles.add(importedMovie.title.toLowerCase());
      }
    });

    saveMovies();

    return res.status(201).json({
      importedCount: imported.length,
      skippedCount: movies.length - imported.length,
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

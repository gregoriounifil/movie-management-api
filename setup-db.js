const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dbDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dbDir, 'database.sqlite');
const legacyCleanupId = 'clear-legacy-movies-2026-04-17';
fs.mkdirSync(dbDir, { recursive: true });

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

const movies = [
  ['Parasite', 'Bong Joon-ho', 2019, 4.6, 'Suspense'],
  ['The Godfather', 'Francis Ford Coppola', 1972, 4.6, 'Crime'],
  ['Everything Everywhere All At Once', 'Daniel Kwan and Daniel Scheinert', 2022, 4.4, 'Ficção científica'],
  ['Spirited Away', 'Hayao Miyazaki', 2001, 4.5, 'Animação'],
  ['Pulp Fiction', 'Quentin Tarantino', 1994, 4.5, 'Crime'],
  ['Seven Samurai', 'Akira Kurosawa', 1954, 4.6, 'Drama'],
  ['Harakiri', 'Masaki Kobayashi', 1962, 4.5, 'Drama'],
  ['Come and See', 'Elem Klimov', 1985, 4.5, 'Guerra'],
  ['12 Angry Men', 'Sidney Lumet', 1957, 4.5, 'Drama'],
  ['The Shawshank Redemption', 'Frank Darabont', 1994, 4.7, 'Drama'],
  ['In the Mood for Love', 'Wong Kar-wai', 2000, 4.4, 'Romance'],
  ['The Dark Knight', 'Christopher Nolan', 2008, 4.5, 'Ação'],
  ['GoodFellas', 'Martin Scorsese', 1990, 4.4, 'Crime'],
  ['City of God', 'Fernando Meirelles and Katia Lund', 2002, 4.3, 'Crime'],
  ['The Lord of the Rings: The Return of the King', 'Peter Jackson', 2003, 4.5, 'Fantasia'],
  ['Portrait of a Lady on Fire', 'Celine Sciamma', 2019, 4.3, 'Romance'],
  ['The Handmaiden', 'Park Chan-wook', 2016, 4.2, 'Suspense'],
  ['Interstellar', 'Christopher Nolan', 2014, 4.4, 'Ficção científica'],
  ['Oldboy', 'Park Chan-wook', 2003, 4.2, 'Suspense'],
  ['Whiplash', 'Damien Chazelle', 2014, 4.3, 'Drama'],
  ['La Haine', 'Mathieu Kassovitz', 1995, 4.2, 'Crime'],
  ['Grave of the Fireflies', 'Isao Takahata', 1988, 4.3, 'Animação']
];

const count = db.prepare('SELECT COUNT(*) AS count FROM movies').get().count;

if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO movies (id, title, director, year, rating, genre)
    VALUES (@id, @title, @director, @year, @rating, @genre)
  `);

  const seed = db.transaction(() => {
    for (const [title, director, year, rating, genre] of movies) {
      insert.run({ id: randomUUID(), title, director, year, rating, genre });
    }
  });

  seed();
  console.log(`${movies.length} filmes inseridos em ${dbPath}`);
} else {
  console.log(`${dbPath} já contém ${count} filme(s); carga inicial ignorada.`);
}

db.prepare('INSERT OR IGNORE INTO app_migrations (id, applied_at) VALUES (?, ?)')
  .run(legacyCleanupId, new Date().toISOString());

db.close();

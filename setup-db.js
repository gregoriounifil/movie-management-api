const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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

const movies = [
  ['Parasite', 'Bong Joon-ho', 2019, 9.2, 'Suspense'],
  ['The Godfather', 'Francis Ford Coppola', 1972, 9.2, 'Crime'],
  ['Everything Everywhere All At Once', 'Daniel Kwan and Daniel Scheinert', 2022, 8.8, 'Ficção científica'],
  ['Spirited Away', 'Hayao Miyazaki', 2001, 9.0, 'Animação'],
  ['Pulp Fiction', 'Quentin Tarantino', 1994, 8.9, 'Crime'],
  ['Seven Samurai', 'Akira Kurosawa', 1954, 9.1, 'Drama'],
  ['Harakiri', 'Masaki Kobayashi', 1962, 9.0, 'Drama'],
  ['Come and See', 'Elem Klimov', 1985, 8.9, 'Guerra'],
  ['12 Angry Men', 'Sidney Lumet', 1957, 9.0, 'Drama'],
  ['The Shawshank Redemption', 'Frank Darabont', 1994, 9.3, 'Drama'],
  ['In the Mood for Love', 'Wong Kar-wai', 2000, 8.7, 'Romance'],
  ['The Dark Knight', 'Christopher Nolan', 2008, 9.0, 'Ação'],
  ['GoodFellas', 'Martin Scorsese', 1990, 8.7, 'Crime'],
  ['City of God', 'Fernando Meirelles and Katia Lund', 2002, 8.6, 'Crime'],
  ['The Lord of the Rings: The Return of the King', 'Peter Jackson', 2003, 9.0, 'Fantasia'],
  ['Portrait of a Lady on Fire', 'Celine Sciamma', 2019, 8.5, 'Romance'],
  ['The Handmaiden', 'Park Chan-wook', 2016, 8.4, 'Suspense'],
  ['Interstellar', 'Christopher Nolan', 2014, 8.7, 'Ficção científica'],
  ['Oldboy', 'Park Chan-wook', 2003, 8.4, 'Suspense'],
  ['Whiplash', 'Damien Chazelle', 2014, 8.5, 'Drama'],
  ['La Haine', 'Mathieu Kassovitz', 1995, 8.4, 'Crime'],
  ['Grave of the Fireflies', 'Isao Takahata', 1988, 8.5, 'Animação']
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
  console.log(`${movies.length} filmes inseridos em db/database.db`);
} else {
  console.log(`db/database.db já contém ${count} filme(s); carga inicial ignorada.`);
}

db.close();

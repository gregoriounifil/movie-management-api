import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';

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
    rating REAL,
    genre TEXT NOT NULL
  );
`);

const movies = [
  ['Parasite', 'Bong Joon-ho', 2019, 4.6, 'Thriller'],
  ['The Godfather', 'Francis Ford Coppola', 1972, 4.6, 'Crime'],
  ['Everything Everywhere All At Once', 'Daniel Kwan and Daniel Scheinert', 2022, 4.4, 'Sci-Fi'],
  ['Spirited Away', 'Hayao Miyazaki', 2001, 4.5, 'Animation'],
  ['Pulp Fiction', 'Quentin Tarantino', 1994, 4.5, 'Crime'],
  ['Seven Samurai', 'Akira Kurosawa', 1954, 4.6, 'Drama'],
  ['Harakiri', 'Masaki Kobayashi', 1962, 4.5, 'Drama'],
  ['Come and See', 'Elem Klimov', 1985, 4.5, 'War'],
  ['12 Angry Men', 'Sidney Lumet', 1957, 4.5, 'Drama'],
  ['The Shawshank Redemption', 'Frank Darabont', 1994, 4.7, 'Drama'],
  ['In the Mood for Love', 'Wong Kar-wai', 2000, 4.4, 'Romance'],
  ['The Dark Knight', 'Christopher Nolan', 2008, 4.5, 'Action'],
  ['GoodFellas', 'Martin Scorsese', 1990, 4.4, 'Crime'],
  ['City of God', 'Fernando Meirelles and Katia Lund', 2002, 4.3, 'Crime'],
  ['The Lord of the Rings: The Return of the King', 'Peter Jackson', 2003, 4.5, 'Fantasy'],
  ['Portrait of a Lady on Fire', 'Celine Sciamma', 2019, 4.3, 'Romance'],
  ['The Handmaiden', 'Park Chan-wook', 2016, 4.2, 'Thriller'],
  ['Interstellar', 'Christopher Nolan', 2014, 4.4, 'Sci-Fi'],
  ['Oldboy', 'Park Chan-wook', 2003, 4.2, 'Thriller'],
  ['Whiplash', 'Damien Chazelle', 2014, 4.3, 'Drama'],
  ['La Haine', 'Mathieu Kassovitz', 1995, 4.2, 'Crime'],
  ['Grave of the Fireflies', 'Isao Takahata', 1988, 4.3, 'Animation']
];

const count = db.prepare('SELECT COUNT(*) AS count FROM movies').get().count;

if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO movies (id, title, director, year, rating, genre)
    VALUES (@id, @title, @director, @year, @rating, @genre)
  `);

  const seed = db.transaction(() => {
    for (const [title, director, year, rating, genre] of movies) {
      insert.run({ id: uuidv4(), title, director, year, rating, genre });
    }
  });

  seed();
  console.log(`Seeded ${movies.length} movies into db/database.db`);
} else {
  console.log(`db/database.db already contains ${count} movie(s); seed skipped.`);
}

db.close();

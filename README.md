# Sistema de Gerenciamento de Filmes - Versão Padrão

Esta é a versão padrão do projeto, focada no gerenciamento manual de filmes. Ela não possui importação externa nem rotinas de scraping.

## Como executar localmente

```bash
npm install
npm run setup-db
npm run dev
```

Depois, acesse:

```text
http://localhost:3000
```

## Funcionalidades

- Cadastrar filmes manualmente com título, diretor, ano, nota e gênero.
- Listar filmes com paginação.
- Pesquisar por título ou gênero em um único campo.
- Excluir filmes cadastrados.
- Atualizar filmes pela API.

## Busca

A interface usa o campo:

```text
Pesquisar filme ou gênero...
```

Enquanto o usuário digita, o frontend chama:

```text
GET /api/movies?search=texto
```

No backend, `search` faz uma busca parcial e sem diferenciar maiúsculas de minúsculas nos campos `title` e `genre`.

Exemplos:

```text
/api/movies?search=god
/api/movies?search=crime
```

## API

### Listar filmes

```text
GET /api/movies
```

Parâmetros opcionais:

- `page`: página atual.
- `limit`: quantidade de filmes por página.
- `sortBy`: campo de ordenação (`title`, `director`, `year`, `rating`, `genre`).
- `order`: `asc` ou `desc`.
- `search`: busca por título ou gênero.

### Criar filme

```text
POST /api/movies
```

Exemplo:

```json
{
  "title": "The Godfather",
  "director": "Francis Ford Coppola",
  "year": 1972,
  "rating": 9.2,
  "genre": "Crime"
}
```

### Buscar por ID

```text
GET /api/movies/:id
```

### Atualizar filme

```text
PUT /api/movies/:id
```

### Excluir filme

```text
DELETE /api/movies/:id
```

## Banco de dados

O projeto usa SQLite com `better-sqlite3`.

Em ambiente local, o banco fica em:

```text
db/database.db
```

Na Vercel, o servidor usa:

```text
/tmp/database.sqlite
```

O diretório `/tmp` é gravável em funções serverless, mas é volátil. Os dados podem ser perdidos quando a função fica inativa, quando uma nova instância é criada ou quando o ambiente é reciclado. Por isso, o SQLite na Vercel deve ser tratado como armazenamento temporário.

Para dados permanentes em produção, use um banco externo como Neon Postgres, Turso, Supabase ou outro serviço persistente.

A tabela `movies` é criada automaticamente quando o servidor inicia:

```sql
CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  director TEXT NOT NULL,
  year INTEGER NOT NULL,
  rating REAL NOT NULL,
  genre TEXT NOT NULL
);
```

## Deploy na Vercel

O arquivo `vercel.json` encaminha chamadas de API para `server.js` e qualquer outra rota para `index.html`.

```json
{
  "version": 2,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/server.js" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

## Scripts

```bash
npm run setup-db
npm run dev
npm start
```

- `setup-db`: cria o banco local e popula dados iniciais se a tabela estiver vazia.
- `dev`: inicia o servidor Express para desenvolvimento.
- `start`: inicia o servidor Express.

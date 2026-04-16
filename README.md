# Sistema de Gerenciamento Manual de Filmes

Aplicacao web simples para gerenciar uma colecao de filmes cadastrados manualmente.

## Como executar

```bash
npm install
npm run setup-db
npm run dev
```

Depois, acesse:

```text
http://localhost:3000
```

## Funcionalidades principais

- Cadastrar filmes com titulo, diretor, ano, nota e genero.
- Listar filmes com paginacao.
- Ordenar por titulo, diretor, ano, nota ou genero.
- Pesquisar por titulo ou genero em um unico campo.
- Excluir filmes cadastrados.
- Atualizar filmes pela API.

## Busca unificada

A interface usa o campo:

```text
Pesquisar filme ou genero...
```

Enquanto o usuario digita, o frontend chama:

```text
GET /api/movies?search=texto
```

No backend, o parametro `search` procura o texto no titulo ou no genero do filme. A busca e parcial e nao diferencia maiusculas de minusculas.

Exemplos:

```text
/api/movies?search=god
/api/movies?search=crime
```

## API principal

### Listar filmes

```text
GET /api/movies
```

Parametros opcionais:

- `page`: pagina atual.
- `limit`: quantidade por pagina.
- `sortBy`: campo de ordenacao (`title`, `director`, `year`, `rating`, `genre`).
- `order`: `asc` ou `desc`.
- `search`: busca por titulo ou genero.

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

O arquivo do banco fica em:

```text
db/database.db
```

A tabela principal e `movies`:

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

## Scripts

```bash
npm run setup-db
npm run dev
npm start
```

- `setup-db`: cria o banco e popula dados iniciais se a tabela estiver vazia.
- `dev`: inicia o servidor Express para desenvolvimento.
- `start`: inicia o servidor Express.

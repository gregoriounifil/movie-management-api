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
  "rating": 4.6,
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

## 🧪 Testando a API

O arquivo `movie-management-api.postman_collection.json` esta na raiz do projeto e pode ser importado no Postman em `Import > Files`. Depois de importar, ajuste a variavel `baseUrl` para o endereco local (`http://localhost:3000`) ou para a URL do Railway.

### Healthcheck

```text
GET /health
```

Verifica se a aplicacao esta respondendo. No Railway, essa rota pode ser usada para confirmar que o servico subiu corretamente.

### Listagem

```text
GET /api/movies
```

Retorna um objeto com `data`, que contem um array de objetos de filmes, e `pagination`, com dados de paginacao.

### Cadastro

```text
POST /api/movies
```

Cria um novo filme enviando JSON com `title`, `director`, `year`, `rating` e `genre`. A escala de nota agora e de 1 a 5.

### Busca

```text
GET /api/movies/search?q=drama
```

Busca filmes usando o parametro de consulta `q`. A busca considera titulo, diretor e genero. A listagem principal tambem aceita `GET /api/movies?search=texto` para pesquisa paginada.

### Remocao

```text
DELETE /api/movies/:id
```

Remove um filme pelo `id`. Na colecao do Postman, o teste de cadastro salva o ID criado na variavel `movieId`, que pode ser usada na rota de remocao.

## Banco de dados

O projeto usa SQLite com `better-sqlite3`. As notas seguem a escala de 1 a 5.

O banco fica em:

```text
data/database.sqlite
```

O diretório `data` é criado automaticamente quando o servidor ou o script de setup inicia.

Na primeira inicialização com essa versão, o servidor executa uma limpeza única para remover filmes antigos do banco e registrar essa migração na tabela `app_migrations`. Depois disso, reinícios e novos deploys não apagam os filmes cadastrados.

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

## Deploy na Railway

O servidor escuta em `process.env.PORT || 3000`, que é o formato esperado pela Railway.

Para manter o SQLite persistente entre deploys, crie um Volume na Railway. O Volume Mount Path deve ser exatamente:

```text
/app/data
```

Com esse volume montado, o arquivo usado pela aplicação será:

```text
/app/data/database.sqlite
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

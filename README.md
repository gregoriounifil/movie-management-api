# Sistema de Gerenciamento de Filmes com Letterboxd

Aplicacao web simples para cadastrar, listar, filtrar, ordenar, excluir e importar filmes de uma pagina publica do Letterboxd.

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

## Funcionalidades

- Cadastro manual de filmes com titulo, diretor, ano, nota e genero.
- Listagem paginada dos filmes salvos.
- Ordenacao por titulo, diretor, ano, nota ou genero.
- Busca unificada por titulo ou genero usando o campo `Pesquisar filme ou genero...`.
- Exclusao de filmes individuais.
- Importacao de filmes a partir de uma URL publica do Letterboxd.

## Busca

A interface envia a busca para:

```text
GET /api/movies?search=texto
```

No backend, o parametro `search` filtra por titulo ou genero com comparacao parcial e sem diferenciar maiusculas de minusculas.

Exemplos:

```text
/api/movies?search=dune
/api/movies?search=drama
```

## Importacao do Letterboxd

A importacao acontece no endpoint:

```text
POST /api/movies/import
```

Corpo esperado:

```json
{
  "url": "https://letterboxd.com/usuario/films/"
}
```

O servidor abre a pagina informada com Puppeteer, espera os posters carregarem e usa Cheerio para ler o HTML renderizado. A primeira etapa coleta titulo, ano, nota do usuario e link individual de cada filme.

Depois disso, o importador acessa a pagina individual de cada filme no Letterboxd para buscar dados que nao aparecem diretamente na grade de filmes:

- diretor, por links de `/director/...`;
- genero, por links de `/films/genre/...`.

Esse enriquecimento deixa a importacao mais lenta, mas evita salvar filmes como `Unknown` ou `Imported` quando o Letterboxd expoe a informacao na pagina do filme.

## Escala de notas

As notas seguem a escala do Letterboxd:

- uma estrela vale `1.0`;
- meias estrelas dentro da nota sao preservadas, por exemplo `3.5`;
- cinco estrelas valem `5.0`;
- filmes sem estrelas ficam com `rating = null`.

A interface mostra `Sem nota` quando a nota estiver nula.

## Banco de dados

O projeto usa SQLite com a biblioteca `better-sqlite3`.

O banco fica em:

```text
data/database.sqlite
```

O diretorio `data` e criado automaticamente quando o servidor ou o script de setup inicia.

Na primeira inicializacao com essa versao, o servidor executa uma limpeza unica para remover filmes antigos do banco e registrar essa migracao na tabela `app_migrations`. Depois disso, reinicios e novos deploys nao apagam os filmes cadastrados.

A tabela principal e `movies`:

```sql
CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  director TEXT NOT NULL,
  year INTEGER NOT NULL,
  rating REAL,
  genre TEXT NOT NULL
);
```

O campo `rating` aceita `NULL` para representar filmes sem nota no Letterboxd.

## Deploy na Railway

O servidor escuta em `process.env.PORT || 3000`, que e o formato esperado pela Railway.

Para manter o SQLite persistente entre deploys, crie um Volume na Railway apontando para:

```text
/app/data
```

Com esse volume montado, o arquivo usado pela aplicacao sera:

```text
/app/data/database.sqlite
```

O `package.json` usa o pacote `puppeteer`, e as chamadas de `puppeteer.launch` incluem os argumentos Linux necessarios para a Railway:

```text
--no-sandbox
--disable-setuid-sandbox
```

## Scripts

```bash
npm run setup-db
npm run dev
npm start
```

- `setup-db`: cria o banco e insere filmes de exemplo se a tabela estiver vazia.
- `dev` e `start`: iniciam o servidor Express.

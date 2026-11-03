# FePost

FePost is an independent FeBlog post editing CLI: it performs `list`, `new`, `pull`, and `save` between local Markdown/MDX copies and the MongoDB `posts` collection. It does not compile MDX, deploy, or indicate that the site has been published.

## Usage

```sh
pnpm install
pnpm cli init
# Edit feblog.config.json
pnpm cli posts list
pnpm cli --profile production posts list --draft
pnpm cli posts new notes/cpp --format mdx
pnpm cli posts pull hello-world
pnpm cli posts save .workspace/posts/local/hello-world.md --yes
```

Configuration, editing copies, and state are only within the repository: `.workspace/posts/<profile>` and `.workspace/state/<profile>`. `feblog.config.json` is a local file, and the example configuration does not contain real credentials.

`save` uses `revision` for conditional updates; when conflicts occur, re-`pull`, merge, and then save. The database should have a unique index on `slug`, and the CLI will not automatically modify indexes. Directly using other tools to modify articles will weaken conflict detection. Successful saving outputs a clear statement that the site has not been rebuilt.

MDX content is saved as-is, and the CLI does not execute or compile MDX; full syntax and page validation are handled by FeBlog. Production writes require `--allow-production` and confirmation (or `--yes`).

## Testing

```sh
pnpm typecheck
pnpm test
```

By default, tests do not connect to a real MongoDB; real integration tests (like adding) must explicitly use an isolated test database.

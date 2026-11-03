import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseArticle, validateSlug } from "../dist/files.js";

const root = path.resolve(".workspace", "test-files");
test.before(async () => { await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true }); });
test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("parses YAML values and preserves Markdown body", async () => {
  const file = path.join(root, "quoted.md");
  await writeFile(file, `---\nslug: nested/quoted\ntitle: "A: title"\ndescription: "line one\\nline two"\npubDatetime: "2025-01-02T03:04:05.000Z"\ntags: [one, two]\n---\n\n# Body\n\n{not executed}\n`);
  const article = await parseArticle(file);
  assert.equal(article.frontmatter.title, "A: title");
  assert.equal(article.frontmatter.slug, "nested/quoted");
  assert.match(article.bodyMarkdown, /# Body/);
});

test("rejects unsafe slugs and mismatched format", async () => {
  assert.throws(() => validateSlug("../escape"), /安全路径/);
  assert.throws(() => validateSlug("a\\b"), /安全路径/);
  const file = path.join(root, "wrong.md");
  await writeFile(file, "---\nslug: wrong\ntitle: title\ndescription: desc\nformat: mdx\n---\nbody");
  await assert.rejects(() => parseArticle(file), /format/);
});

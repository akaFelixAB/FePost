import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export interface Frontmatter {
    slug: string;
    title: string;
    description: string;
    author?: string;
    format?: 'markdown' | 'mdx';
    pubDatetime?: string | Date | null;
    modDatetime?: string | Date | null;
    draft?: boolean;
    featured?: boolean;
    tags?: string[];
    ogImage?: string;
    canonicalURL?: string;
    hideEditPost?: boolean;
    timezone?: string;
}
export interface ArticleFile {
    file: string;
    format: 'markdown' | 'mdx';
    frontmatter: Frontmatter;
    bodyMarkdown: string;
}
const allowed = new Set([
    'slug',
    'title',
    'description',
    'author',
    'format',
    'pubDatetime',
    'modDatetime',
    'draft',
    'featured',
    'tags',
    'ogImage',
    'canonicalURL',
    'hideEditPost',
    'timezone',
]);

export function workspaceRoot(root: string, profile: string, kind: 'posts' | 'state'): string {
    return path.join(root, '.workspace', kind, profile);
}
export function validateSlug(slug: string): void {
    if (
        !slug ||
        path.isAbsolute(slug) ||
        slug.includes('\\') ||
        slug.split('/').some((part) => !part || part === '.' || part === '..')
    )
        throw new Error('slug must be a non-empty relative path without .. or . components.');
}
function validateFrontmatter(value: unknown): Frontmatter {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('frontmatter must be a YAML object.');
    const raw = value as Record<string, unknown>;
    for (const key of Object.keys(raw))
        if (!allowed.has(key)) throw new Error(`Invalid frontmatter field: ${key}`);
    for (const key of ['slug', 'title', 'description'])
        if (typeof raw[key] !== 'string' || !raw[key])
            throw new Error(`${key} must be a non-empty string.`);
    validateSlug(raw.slug as string);
    if (raw.format !== undefined && raw.format !== 'markdown' && raw.format !== 'mdx')
        throw new Error('format must be markdown or mdx.');
    for (const key of ['draft', 'featured', 'hideEditPost'])
        if (raw[key] !== undefined && typeof raw[key] !== 'boolean')
            throw new Error(`${key} must be a boolean.`);
    if (
        raw.tags !== undefined &&
        (!Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== 'string'))
    )
        throw new Error('tags must be a string array.');
    for (const key of ['pubDatetime', 'modDatetime'])
        if (
            raw[key] !== undefined &&
            raw[key] !== null &&
            !(raw[key] instanceof Date) &&
            (typeof raw[key] !== 'string' || Number.isNaN(Date.parse(raw[key])))
        )
            throw new Error(`${key} must be a valid date.`);
    return raw as unknown as Frontmatter;
}
export async function parseArticle(file: string): Promise<ArticleFile> {
    const extension = path.extname(file);
    if (extension !== '.md' && extension !== '.mdx')
        throw new Error('Only .md and .mdx files are accepted.');
    const text = await readFile(file, 'utf8');
    const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
    if (!match) throw new Error('Article is missing YAML frontmatter.');
    const frontmatter = validateFrontmatter(parse(match[1] ?? ''));
    const format = extension === '.mdx' ? 'mdx' : 'markdown';
    if (frontmatter.format !== undefined && frontmatter.format !== format)
        throw new Error('frontmatter format does not match the file extension.');
    return { file, format, frontmatter, bodyMarkdown: match[2] ?? '' };
}
export function serializeArticle(article: {
    frontmatter: Record<string, unknown>;
    bodyMarkdown: string;
}): string {
    return `---\n${stringify(article.frontmatter, { lineWidth: 0 })}---\n${article.bodyMarkdown}`;
}
function inside(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function ensureWithin(root: string, file: string): Promise<void> {
    const absolute = path.resolve(file);
    if (!inside(root, absolute))
        throw new Error("File must be within the current profile's posts directory.");
    let current = path.dirname(absolute);
    const rootReal = await realpath(root).catch(() => root);
    while (inside(root, current)) {
        const stat = await lstat(current).catch(() => undefined);
        if (stat?.isSymbolicLink())
            throw new Error('Cannot access posts directory through symbolic links.');
        if (current === root) break;
        current = path.dirname(current);
    }
    const parentReal = await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute));
    if (!inside(rootReal, parentReal)) throw new Error('File path escapes the allowed directory.');
}
export async function atomicWrite(file: string, content: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, file);
}
export function articlePath(
    root: string,
    profile: string,
    slug: string,
    format: 'markdown' | 'mdx'
): string {
    validateSlug(slug);
    return path.join(
        workspaceRoot(root, profile, 'posts'),
        `${slug}.${format === 'mdx' ? 'mdx' : 'md'}`
    );
}

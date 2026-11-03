import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MongoClient, ObjectId, type Collection, type Document } from 'mongodb';
import {
    articlePath,
    atomicWrite,
    parseArticle,
    serializeArticle,
    validateSlug,
    workspaceRoot,
    type ArticleFile,
    type Frontmatter,
} from './files.js';
import type { Profile } from './config.js';

type Post = Document & {
    slug?: unknown;
    title?: unknown;
    description?: unknown;
    bodyMarkdown?: unknown;
    format?: unknown;
    revision?: unknown;
    _id?: unknown;
    pubDatetime?: unknown;
    modDatetime?: unknown;
    draft?: unknown;
    featured?: unknown;
    tags?: unknown;
};
type State = {
    version: 1;
    profile: string;
    identity: string;
    id: string;
    slug: string;
    revision?: number;
    file: string;
};
const editable = [
    'title',
    'description',
    'author',
    'pubDatetime',
    'modDatetime',
    'draft',
    'featured',
    'tags',
    'ogImage',
    'canonicalURL',
    'hideEditPost',
    'timezone',
    'bodyMarkdown',
    'format',
] as const;

function targetIdentity(profile: Profile): string {
    const parsed = new URL(profile.uri);
    return createHash('sha256')
        .update(
            `${parsed.protocol}//${parsed.hostname}:${parsed.port || 'default'}/${profile.database}/${profile.collection}`
        )
        .digest('hex')
        .slice(0, 16);
}
function statePath(root: string, profile: string, slug: string): string {
    return path.join(workspaceRoot(root, profile, 'state'), `${slug}.json`);
}
function asDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.valueOf()) ? null : date;
    }
    return null;
}
function outputDate(value: unknown): string | undefined {
    return asDate(value)?.toISOString();
}
function bsonId(value: unknown): string {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string') return value;
    throw new Error('Unsupported MongoDB _id type; only ObjectId or string is supported.');
}
function queryId(value: string): ObjectId | string {
    return ObjectId.isValid(value) ? new ObjectId(value) : value;
}
async function withCollection<T>(
    profile: Profile,
    action: (collection: Collection<Post>) => Promise<T>
): Promise<T> {
    const client = new MongoClient(profile.uri, {
        connectTimeoutMS: 5000,
        serverSelectionTimeoutMS: 5000,
    });
    try {
        await client.connect();
        return await action(client.db(profile.database).collection<Post>(profile.collection));
    } finally {
        await client.close();
    }
}
function frontmatterFromPost(post: Post, format: 'markdown' | 'mdx'): Record<string, unknown> {
    const result: Record<string, unknown> = {
        slug: post.slug,
        title: post.title,
        description: post.description,
        draft: post.draft ?? false,
        tags: post.tags ?? ['others'],
    };
    for (const key of [
        'author',
        'featured',
        'ogImage',
        'canonicalURL',
        'hideEditPost',
        'timezone',
    ] as const)
        if (post[key] !== undefined) result[key] = post[key];
    const pub = outputDate(post.pubDatetime);
    if (pub) result.pubDatetime = pub;
    const mod = outputDate(post.modDatetime);
    if (mod) result.modDatetime = mod;
    return result;
}
function toMongo(frontmatter: Frontmatter, article: ArticleFile): Record<string, unknown> {
    const result: Record<string, unknown> = {
        slug: frontmatter.slug,
        title: frontmatter.title,
        description: frontmatter.description,
        bodyMarkdown: article.bodyMarkdown,
        format: article.format,
    };
    for (const key of editable)
        if (key !== 'bodyMarkdown' && key !== 'format' && frontmatter[key] !== undefined)
            result[key] =
                key.endsWith('Datetime') && frontmatter[key]
                    ? new Date(frontmatter[key] as string | Date)
                    : frontmatter[key];
    return result;
}
async function readState(root: string, profile: string, slug: string): Promise<State | undefined> {
    try {
        return JSON.parse(await readFile(statePath(root, profile, slug), 'utf8')) as State;
    } catch {
        return undefined;
    }
}
export async function listPosts(
    profile: Profile,
    limit: number,
    draftOnly: boolean
): Promise<string[]> {
    return withCollection(profile, async (collection) => {
        const posts = await collection
            .find(draftOnly ? { draft: true } : {}, {
                projection: {
                    slug: 1,
                    title: 1,
                    format: 1,
                    draft: 1,
                    pubDatetime: 1,
                    modDatetime: 1,
                    revision: 1,
                },
                limit,
            })
            .toArray();
        return posts.map(
            (post) =>
                `${String(post.slug ?? '(No slug)')}\t${String(post.title ?? '(No title)')}\t${post.format === 'mdx' ? 'mdx' : 'markdown'}\t${post.draft === true ? 'draft' : 'published'}\t${outputDate(post.modDatetime) ?? outputDate(post.pubDatetime) ?? '(No date)'}\t${typeof post.revision === 'number' ? post.revision : '-'}`
        );
    });
}
export async function pullPost(
    root: string,
    profileName: string,
    profile: Profile,
    slug: string
): Promise<string> {
    validateSlug(slug);
    return withCollection(profile, async (collection) => {
        const posts = await collection.find({ slug }, { limit: 2 }).toArray();
        if (posts.length === 0) throw new Error(`Article not found: ${slug}`);
        if (posts.length > 1)
            throw new Error(`slug "${slug}" corresponds to multiple articles, export rejected.`);
        const post = posts[0];
        if (!post) throw new Error(`Article not found: ${slug}`);
        const format = post.format === 'mdx' ? 'mdx' : 'markdown';
        const postsRoot = workspaceRoot(root, profileName, 'posts');
        for (const extension of ['.md', '.mdx'])
            if (
                await access(path.join(postsRoot, `${slug}${extension}`))
                    .then(() => true)
                    .catch(() => false)
            )
                throw new Error(
                    `Local file already exists, refusing to overwrite: ${slug}${extension}`
                );
        const file = articlePath(root, profileName, slug, format);
        await atomicWrite(
            file,
            serializeArticle({
                frontmatter: frontmatterFromPost(post, format),
                bodyMarkdown: typeof post.bodyMarkdown === 'string' ? post.bodyMarkdown : '',
            })
        );
        const state: State = {
            version: 1,
            profile: profileName,
            identity: targetIdentity(profile),
            id: bsonId(post._id),
            slug,
            ...(typeof post.revision === 'number' ? { revision: post.revision } : {}),
            file: path.relative(root, file),
        };
        await mkdir(path.dirname(statePath(root, profileName, slug)), { recursive: true });
        await writeFile(
            statePath(root, profileName, slug),
            `${JSON.stringify(state, null, 2)}\n`,
            'utf8'
        );
        return `Pulled ${state.file}`;
    });
}
export async function savePost(
    root: string,
    profileName: string,
    profile: Profile,
    file: string,
    yes: boolean,
    allowProduction: boolean,
    confirm: () => Promise<boolean>
): Promise<string> {
    const article = await parseArticle(file);
    const state = await readState(root, profileName, article.frontmatter.slug);
    const mongo = toMongo(article.frontmatter, article);
    const result = await withCollection(profile, async (collection) => {
        const existing = state
            ? await collection.findOne({ _id: queryId(state.id) } as Document)
            : await collection.findOne({ slug: article.frontmatter.slug });
        const update = Boolean(state);
        if (update && !existing)
            throw new Error(
                'State indicates an existing article, but the article is not found in the database; please pull first.'
            );
        const current = existing;
        if (!update && existing)
            throw new Error(
                'Database already has an article with the same slug, please pull first and then save.'
            );
        if (!yes && !(await confirm())) throw new Error('Save operation cancelled by user.');
        if (profile.production && !allowProduction)
            throw new Error('production profile requires --allow-production.');
        if (update) {
            if (state?.identity !== targetIdentity(profile))
                throw new Error(
                    'State identity does not match the current profile; please pull first.'
                );
            if (!current || current.slug !== article.frontmatter.slug)
                throw new Error('Cannot update article; slug mismatch between state and database.');
            if (current.revision !== undefined && typeof current.revision !== 'number')
                throw new Error('Database article has an invalid revision; expected a number.');
            const filter: Document = {
                _id: queryId(state.id),
                slug: state.slug,
                ...(state.revision === undefined
                    ? { revision: { $exists: false } }
                    : { revision: state.revision }),
            };
            const unset: Record<string, ''> = {};
            for (const key of [
                'author',
                'pubDatetime',
                'modDatetime',
                'featured',
                'ogImage',
                'canonicalURL',
                'hideEditPost',
                'timezone',
            ] as const)
                if (!(key in article.frontmatter)) unset[key] = '';
            const updateDoc: Document = {
                $set: { ...mongo, revision: (state.revision ?? 0) + 1, modDatetime: new Date() },
                ...(Object.keys(unset).length ? { $unset: unset } : {}),
            };
            const updated = await collection.updateOne(filter, updateDoc);
            if (updated.matchedCount !== 1)
                throw new Error(
                    'Article revision conflict, database not overwritten; please pull again and merge.'
                );
            return { revision: (state.revision ?? 0) + 1, action: 'update' };
        }
        let insertedId: string;
        try {
            const inserted = await collection.insertOne({ ...mongo, revision: 1 });
            insertedId = bsonId(inserted.insertedId);
        } catch (error) {
            if (
                error instanceof Error &&
                'code' in error &&
                (error as { code?: number }).code === 11000
            )
                throw new Error(
                    'Database already has an article with the same slug, please pull first and then save.'
                );
            throw error;
        }
        return { revision: 1, action: 'create', id: insertedId };
    });
    try {
        await mkdir(path.dirname(statePath(root, profileName, article.frontmatter.slug)), {
            recursive: true,
        });
        const id = state?.id ?? result.id;
        if (!id) throw new Error('Database returned article identity is missing.');
        const savedState: State = {
            version: 1,
            profile: profileName,
            identity: targetIdentity(profile),
            id,
            slug: article.frontmatter.slug,
            revision: result.revision,
            file: path.relative(root, file),
        };
        await writeFile(
            statePath(root, profileName, article.frontmatter.slug),
            `${JSON.stringify(savedState, null, 2)}\n`,
            'utf8'
        );
    } catch (error) {
        throw new Error(
            `Database saved successfully, but local state update failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return `Saved to MongoDB (${result.action}). The live website has not been rebuilt.`;
}

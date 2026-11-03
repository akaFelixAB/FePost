#!/usr/bin/env node
import { Command } from 'commander';
import { copyFile, mkdir, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { loadConfig, projectRoot, selectProfile } from './config.js';
import { articlePath, atomicWrite, ensureWithin, validateSlug, workspaceRoot } from './files.js';
import { listPosts, pullPost, savePost } from './posts.js';

const program = new Command();
program.name('feblog').description('FeBlog local article management CLI').version('1.0.0');
program
    .option('--config <path>', 'repository-local config path')
    .option('--profile <name>', 'profile name')
    .option('--yes', 'skip ordinary save confirmation')
    .option('--allow-production', 'allow writes to production profile');
program
    .command('init')
    .description('create local config and workspace')
    .action(async () => {
        const root = projectRoot();
        const config = path.join(root, 'feblog.config.json');
        if (
            await access(config)
                .then(() => true)
                .catch(() => false)
        ) {
            throw new Error('feblog.config.json Already exists, cannot overwrite.');
        }
        await copyFile(path.join(root, 'feblog.config.example.json'), config);
        await mkdir(path.join(root, '.workspace', 'posts'), { recursive: true });
        await mkdir(path.join(root, '.workspace', 'state'), { recursive: true });
        console.log(
            'Created feblog.config.json and .workspace. No database connection. Please edit feblog.config.json and run again.'
        );
    });
const posts = program.command('posts').description('manage local article copies and MongoDB posts');
posts
    .command('list')
    .option(
        '--limit <number>',
        'maximum rows',
        (value) => {
            const n = Number(value);
            if (!Number.isInteger(n) || n < 1) throw new Error('limit must be a positive integer.');
            return n;
        },
        50
    )
    .option('--draft', 'only drafts')
    .action(async (options) => {
        const config = await loadConfig(program.opts().config);
        const [, profile] = selectProfile(config, program.opts().profile);
        console.log(['slug', 'title', 'format', 'status', 'date', 'revision'].join('\t'));
        for (const line of await listPosts(profile, options.limit, options.draft === true)) {
            console.log(line);
        }
    });
posts
    .command('new <slug>')
    .option('--format <format>', 'markdown or mdx', 'markdown')
    .action(async (slug: string, options: { format: string }) => {
        if (options.format !== 'markdown' && options.format !== 'mdx')
            throw new Error('format must be either markdown or mdx.');
        validateSlug(slug);
        const config = await loadConfig(program.opts().config);
        const [name] = selectProfile(config, program.opts().profile);
        const file = articlePath(projectRoot(), name, slug, options.format);
        if (
            await access(file)
                .then(() => true)
                .catch(() => false)
        )
            throw new Error('Post file already exists, cannot overwrite.');
        await mkdir(path.dirname(file), { recursive: true });
        await atomicWrite(
            file,
            `---\nslug: ${slug}\ntitle: ${slug}\ndescription: \"\"\ndraft: true\ntags:\n  - others\n---\n\n`
        );
        console.log(`Created ${path.relative(projectRoot(), file)}`);
    });
posts.command('pull <slug>').action(async (slug) => {
    const config = await loadConfig(program.opts().config);
    const [name, profile] = selectProfile(config, program.opts().profile);
    console.log(await pullPost(projectRoot(), name, profile, slug));
});
posts.command('save <file>').action(async (file) => {
    const config = await loadConfig(program.opts().config);
    const [name, profile] = selectProfile(config, program.opts().profile);
    if (profile.production && !program.opts().allowProduction)
        throw new Error('production profile requires --allow-production。');
    const root = projectRoot();
    const absolute = path.resolve(root, file);
    const postsRoot = workspaceRoot(root, name, 'posts');
    await ensureWithin(postsRoot, absolute);
    console.log(
        await savePost(
            root,
            name,
            profile,
            absolute,
            Boolean(program.opts().yes),
            Boolean(program.opts().allowProduction),
            async () => {
                if (!process.stdin.isTTY)
                    throw new Error('Non-interactive environment requires --yes。');
                process.stdout.write('Save to MongoDB? [y/N] ');
                const input = createInterface({ input: process.stdin, output: process.stdout });
                try {
                    for await (const line of input) return /^y(es)?$/i.test(line.trim());
                    return false;
                } finally {
                    input.close();
                }
            }
        )
    );
});
try {
    await program.parseAsync();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
        `Error: ${message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, 'mongodb://[redacted]')}`
    );
    process.exitCode = 1;
}

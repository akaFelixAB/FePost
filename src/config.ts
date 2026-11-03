import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface Profile {
    uri: string;
    database: string;
    collection: string;
    production: boolean;
}
export interface Config {
    defaultProfile: string;
    profiles: Record<string, Profile>;
}

export function projectRoot(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}
function inside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}
export async function loadConfig(requested?: string): Promise<Config> {
    const root = projectRoot();
    const file = path.resolve(root, requested ?? 'feblog.config.json');
    if (!inside(root, file))
        throw new Error('Config file cannot escape the CLI repository via symlink.');
    let realFile: string;
    try {
        realFile = await realpath(file);
    } catch {
        throw new Error(`Config file does not exist: ${path.relative(root, file)}`);
    }
    if (!inside(root, realFile))
        throw new Error('Config file cannot escape the CLI repository via symlink.');
    let value: unknown;
    try {
        value = JSON.parse(await readFile(realFile, 'utf8'));
    } catch {
        throw new Error('Config file is not valid JSON.');
    }
    if (!value || typeof value !== 'object') throw new Error('Config must be a JSON object.');
    const raw = value as Record<string, unknown>;
    if (
        typeof raw.defaultProfile !== 'string' ||
        !raw.defaultProfile ||
        !raw.profiles ||
        typeof raw.profiles !== 'object'
    )
        throw new Error('Config must include defaultProfile and profiles.');
    const profiles: Record<string, Profile> = {};
    for (const [name, candidate] of Object.entries(raw.profiles as Record<string, unknown>)) {
        if (!candidate || typeof candidate !== 'object')
            throw new Error(`profile "${name}" is invalid.`);
        const profile = candidate as Record<string, unknown>;
        if (
            typeof profile.uri !== 'string' ||
            typeof profile.database !== 'string' ||
            typeof profile.collection !== 'string' ||
            typeof profile.production !== 'boolean'
        )
            throw new Error(
                `profile "${name}" is missing valid uri, database, collection, or production.`
            );
        profiles[name] = {
            uri: profile.uri,
            database: profile.database,
            collection: profile.collection,
            production: profile.production,
        };
    }
    if (!profiles[raw.defaultProfile]) throw new Error('defaultProfile file does not exist.');
    return { defaultProfile: raw.defaultProfile, profiles };
}
export function selectProfile(config: Config, requested?: string): [string, Profile] {
    const name = requested ?? config.defaultProfile;
    const profile = config.profiles[name];
    if (!profile) throw new Error(`profile "${name}" does not exist.`);
    return [name, profile];
}

import fs from 'fs/promises';
import path from 'path';
import sanitizeHTML from 'sanitize-html';
import nconf from 'nconf';
import winston from 'winston';

import file from '../file';
import { Translator } from '../translator';

interface NamespaceInfo {
    namespace: string;
    translations: string;
    title?: string;
}

interface FallbackCache {
    [key: string]: NamespaceInfo;
}

function filterDirectories(directories: string[]): string[] {
    return directories.map(
        dir => dir.replace(/^.*(admin.*?).tpl$/, '$1').split(path.sep).join('/')
    ).filter(
        dir => (
            !dir.endsWith('.js') &&
            !dir.includes('/partials/') &&
            /\/.*\//.test(dir) &&
            !/manage\/(category|group|category-analytics)$/.test(dir)
        )
    );
}

async function getAdminNamespaces(): Promise<string[]> {
    try {
        const viewsDir: string = nconf.get('views_dir') as string;
        if (typeof viewsDir !== 'string') {
            throw new Error('Views directory path is not a string');
        }
        const directories: string[] = await file.walk(path.resolve(viewsDir, 'admin')) as string[];
        return filterDirectories(directories);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('Error fetching admin namespaces:', error.message);
        } else {
            console.error('An unknown error occurred while fetching admin namespaces.');
        }
        return [];
    }
}

function sanitize(html: string): string {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    return sanitizeHTML(html, {
        allowedTags: [],
        allowedAttributes: [],
    }) as string;
}

function simplify(translations: string): string {
    return translations
        .replace(/(?:\{{1,2}[^}]*?\}{1,2})/g, '')
        .replace(/(?:[ \t]*[\n\r]+[ \t]*)+/g, '\n')
        .replace(/[\t ]+/g, ' ');
}

function nsToTitle(namespace: string): string {
    return namespace.replace('admin/', '').split('/').map(str => str[0].toUpperCase() + str.slice(1)).join(' > ')
        .replace(/[^a-zA-Z> ]/g, ' ');
}

const fallbackCache: FallbackCache = {};

async function initFallback(namespace: string): Promise<NamespaceInfo> {
    const template = await fs.readFile(path.resolve(nconf.get('views_dir') as string, `${namespace}.tpl`), 'utf8');
    const title = nsToTitle(namespace);
    let translations = sanitize(template);
    translations = Translator.removePatterns(translations);
    translations = simplify(translations);
    translations += `\n${title}`;

    return {
        namespace,
        translations,
        title,
    };
}

async function fallback(namespace: string): Promise<NamespaceInfo> {
    if (fallbackCache[namespace]) {
        return fallbackCache[namespace];
    }

    const params = await initFallback(namespace);
    fallbackCache[namespace] = params;
    return params;
}

async function buildNamespace(language: string, namespace: string): Promise<NamespaceInfo> {
    if (!namespace) {
        throw new Error('Namespace is undefined or null');
    }

    const translator = Translator.create(language);
    try {
        const translations: { [key: string]: string } = await translator.getTranslation(namespace);
        if (!translations || !Object.keys(translations).length) {
            return await fallback(namespace);
        }
        // join all translations into one string separated by newlines
        let str = Object.keys(translations).map(key => translations[key]).join('\n');
        str = sanitize(str);

        let title = namespace;
        const matchResult = title.match(/admin\/(.+?)\/(.+?)$/);
        title = matchResult ? `[[admin/menu:section-${matchResult[1] === 'development' ? 'advanced' : matchResult[1]}]]${matchResult[2] ? (` > [[admin/menu:${matchResult[1]}/${matchResult[2]}]]`) : ''}` : '';

        title = await translator.translate(title);
        return {
            namespace: namespace,
            translations: `${str}\n${title}`,
            title: title,
        };
    } catch (err) {
        if (err instanceof Error && err.stack) { // Check if err is an Error instance and has a stack property
            winston.error(err.stack);
        } else {
            winston.error(err);
        }
        return {
            namespace: namespace,
            translations: '',
        };
    }
}

async function initDict(language: string): Promise<NamespaceInfo[]> {
    const namespaces = await getAdminNamespaces();
    return await Promise.all(namespaces.map(ns => buildNamespace(language, ns)));
}

const cache: { [key: string]: NamespaceInfo[] } = {};

async function getDictionary(language: string): Promise<NamespaceInfo[]> {
    if (cache[language]) {
        return cache[language];
    }

    const params = await initDict(language);
    cache[language] = params;
    return params;
}

export {
    getDictionary,
    filterDirectories,
    simplify,
    sanitize,
};

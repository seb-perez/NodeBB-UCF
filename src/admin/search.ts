'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as sanitizeHTML from 'sanitize-html';
import * as nconf from 'nconf';
import * as winston from 'winston';
import * as file from '../file';
import { Translator } from '../translator';

function filterDirectories(directories: string[]): string[] {
    return directories.map(
        // get the relative path
        // convert dir to use forward slashes
        dir => dir.replace(/^.*(admin.*?).tpl$/, '$1').split(path.sep).join('/')
    ).filter(
        // exclude .js files
        // exclude partials
        // only include subpaths
        // exclude category.tpl, group.tpl, category-analytics.tpl
        dir => (
            !dir.endsWith('.js') &&
            !dir.includes('/partials/') &&
            /\/.*\//.test(dir) &&
            !/manage\/(category|group|category-analytics)$/.test(dir)
        )
    );
}

async function getAdminNamespaces(): Promise<string[]> {
    const directories = await file.walk(path.resolve(nconf.get('views_dir'), 'admin'));
    return filterDirectories(directories);
}

function sanitize(html: string): string {
    // reduce the template to just meaningful text
    // remove all tags and strip out scripts, etc completely
    return sanitizeHTML(html, {
        allowedTags: [],
        allowedAttributes: [],
    });
}

function simplify(translations: string): string {
    return translations
        // remove all mustaches
        .replace(/(?:\{{1,2}[^}]*?\}{1,2})/g, '')
        // collapse whitespace
        .replace(/(?:[ \t]*[\n\r]+[ \t]*)+/g, '\n')
        .replace(/[\t ]+/g, ' ');
}

function nsToTitle(namespace: string): string {
    return namespace.replace('admin/', '').split('/').map(str => str[0].toUpperCase() + str.slice(1)).join(' > ')
        .replace(/[^a-zA-Z> ]/g, ' ');
}

interface FallbackParams {
    namespace: string;
    translations: string;
    title?: string;
}

const fallbackCache: { [key: string]: FallbackParams } = {};

async function initFallback(namespace: string): Promise<FallbackParams> {
    const template = await fs.promises.readFile(path.resolve(nconf.get('views_dir'), `${namespace}.tpl`), 'utf8');

    const title = nsToTitle(namespace);
    let translations = sanitize(template);
    translations = Translator.removePatterns(translations);
    translations = simplify(translations);
    translations += `\n${title}`;

    return {
        namespace: namespace,
        translations: translations,
        title: title,
    };
}

async function fallback(namespace: string): Promise<FallbackParams> {
    if (fallbackCache[namespace]) {
        return fallbackCache[namespace];
    }

    const params = await initFallback(namespace);
    fallbackCache[namespace] = params;
    return params;
}

async function initDict(language: string): Promise<FallbackParams[]> {
    const namespaces = await getAdminNamespaces();
    return await Promise.all(namespaces.map(ns => buildNamespace(language, ns)));
}

async function buildNamespace(language: string, namespace: string): Promise<FallbackParams> {
    const translator = Translator.create(language);
    try {
        const translations = await translator.getTranslation(namespace);
        if (!translations || !Object.keys(translations).length) {
            return await fallback(namespace);
        }
        // join all translations into one string separated by newlines
        let str = Object.keys(translations).map(key => translations[key]).join('\n');
        str = sanitize(str);

        let title = namespace;
        const matchResult = title.match(/admin\/(.+?)\/(.+?)$/);
        title = matchResult ? `[[admin/menu:section-${
            matchResult[1] === 'development' ? 'advanced' : matchResult[1]
        }]]${matchResult[2] ? (` > [[admin/menu:${
            matchResult[1]}/${matchResult[2]}]]`) : ''}` : '';

        title = await translator.translate(title);
        return {
            namespace: namespace,
            translations: `${str}\n${title}`,
            title: title,
        };
    } catch (err) {
        winston.error(err.stack);
        return {
            namespace: namespace,
            translations: '',
        };
    }
}

const cache: { [key: string]: FallbackParams[] } = {};

async function getDictionary(language: string): Promise<FallbackParams[]> {
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
    sanitize
};
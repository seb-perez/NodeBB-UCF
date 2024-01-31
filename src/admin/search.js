"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitize = exports.simplify = exports.filterDirectories = exports.getDictionary = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sanitize_html_1 = __importDefault(require("sanitize-html"));
const nconf = __importStar(require("nconf"));
const winston = __importStar(require("winston"));
const file = __importStar(require("../file"));
const translator_1 = require("../translator");
function filterDirectories(directories) {
    return directories.map(
    // get the relative path
    // convert dir to use forward slashes
    (dir) => dir.replace(/^.*(admin.*?).tpl$/, '$1').split(path.sep).join('/')).filter(
    // exclude .js files
    // exclude partials
    // only include subpaths
    // exclude category.tpl, group.tpl, category-analytics.tpl
    (dir) => (!dir.endsWith('.js') &&
        !dir.includes('/partials/') &&
        /\/.*\//.test(dir) &&
        !/manage\/(category|group|category-analytics)$/.test(dir)));
}
exports.filterDirectories = filterDirectories;
function getAdminNamespaces() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const viewsDir = nconf.get('views_dir');
            if (typeof viewsDir !== 'string') {
                throw new Error('Views directory path is not a string');
            }
            const directories = yield file.walk(path.resolve(viewsDir, 'admin'));
            return filterDirectories(directories);
        }
        catch (error) {
            if (error instanceof Error) {
                console.error('Error fetching admin namespaces:', error.message);
            }
            else {
                console.error('An unknown error occurred while fetching admin namespaces.');
            }
            return [];
        }
    });
}
function sanitize(html) {
    // reduce the template to just meaningful text
    // remove all tags and strip out scripts, etc completely
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const sanitizedHTML = (0, sanitize_html_1.default)(html, {
        allowedTags: [],
        allowedAttributes: [],
    });
    if (typeof sanitizedHTML !== 'string') {
        throw new Error('Sanitized HTML is not a string.');
    }
    return sanitizedHTML;
}
exports.sanitize = sanitize;
function simplify(translations) {
    return translations
        // remove all mustaches
        .replace(/(?:\{{1,2}[^}]*?\}{1,2})/g, '')
        // collapse whitespace
        .replace(/(?:[ \t]*[\n\r]+[ \t]*)+/g, '\n')
        .replace(/[\t ]+/g, ' ');
}
exports.simplify = simplify;
function nsToTitle(namespace) {
    return namespace.replace('admin/', '').split('/').map(str => str[0].toUpperCase() + str.slice(1)).join(' > ')
        .replace(/[^a-zA-Z> ]/g, ' ');
}
const fallbackCache = {};
function initFallback(namespace) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const viewsDir = nconf.get('views_dir');
            if (typeof viewsDir !== 'string') {
                throw new Error('Views directory path is not a string');
            }
            const templatePath = path.resolve(viewsDir, `${namespace}.tpl`);
            const template = yield fs.promises.readFile(templatePath, 'utf8');
            const title = nsToTitle(namespace);
            let translations = sanitize(template);
            translations = translator_1.Translator.removePatterns(translations);
            translations = simplify(translations);
            translations += `\n${title}`;
            return {
                namespace: namespace,
                translations: translations,
                title: title,
            };
        }
        catch (error) {
            if (error instanceof Error) {
                console.error(`Error initializing fallback for namespace ${namespace}:`, error.message);
            }
            else {
                console.error(`An unknown error occurred while initializing fallback for namespace ${namespace}.`);
            }
            return {
                namespace: namespace,
                translations: '',
            };
        }
    });
}
function fallback(namespace) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fallbackCache[namespace]) {
            return fallbackCache[namespace];
        }
        const params = yield initFallback(namespace);
        fallbackCache[namespace] = params;
        return params;
    });
}
function buildNamespace(language, namespace) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!namespace) {
            throw new Error('Namespace is undefined or null');
        }
        const translator = translator_1.Translator.create(language);
        try {
            const translations = yield translator.getTranslation(namespace);
            if (!translations || !Object.keys(translations).length) {
                return yield fallback(namespace);
            }
            // join all translations into one string separated by newlines
            let str = Object.keys(translations).map(key => translations[key]).join('\n');
            str = sanitize(str);
            let title = namespace;
            const matchResult = title.match(/admin\/(.+?)\/(.+?)$/);
            title = matchResult ? `[[admin/menu:section-${matchResult[1] === 'development' ? 'advanced' : matchResult[1]}]]${matchResult[2] ? (` > [[admin/menu:${matchResult[1]}/${matchResult[2]}]]`) : ''}` : '';
            title = yield translator.translate(title);
            return {
                namespace: namespace,
                translations: `${str}\n${title}`,
                title: title,
            };
        }
        catch (err) {
            if (err instanceof Error && err.stack) { // Check if err is an Error instance and has a stack property
                winston.error(err.stack);
            }
            else {
                winston.error(err);
            }
            return {
                namespace: namespace,
                translations: '',
            };
        }
    });
}
function initDict(language) {
    return __awaiter(this, void 0, void 0, function* () {
        const namespaces = yield getAdminNamespaces();
        return yield Promise.all(namespaces.map(ns => buildNamespace(language, ns)));
    });
}
const cache = {};
function getDictionary(language) {
    return __awaiter(this, void 0, void 0, function* () {
        if (cache[language]) {
            return cache[language];
        }
        const params = yield initDict(language);
        cache[language] = params;
        return params;
    });
}
exports.getDictionary = getDictionary;

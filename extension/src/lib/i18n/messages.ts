import en from '../../locales/en.json';
import de from '../../locales/de.json';
import type { SupportedLocale } from './resolve-locale';

interface MessageTree {
  [key: string]: string | MessageTree;
}

const catalogs: Record<SupportedLocale, MessageTree> = { en, de };

function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split('.');
  let node: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function getMessage(locale: SupportedLocale, key: string): string {
  const fromLocale = lookup(catalogs[locale], key);
  if (fromLocale !== undefined) return fromLocale;
  const fromEn = lookup(catalogs.en, key);
  if (fromEn !== undefined) return fromEn;
  return key;
}

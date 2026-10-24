import { format, getMessage } from './messages';
import { resolveLocale, type SupportedLocale } from './resolve-locale';

export type { SupportedLocale };

export const locale: SupportedLocale = resolveLocale(
  typeof navigator !== 'undefined' ? navigator.languages : ['en']
);

export function t(key: string, params?: Record<string, string | number>): string {
  return format(getMessage(locale, key), params);
}

export function tPlural(
  baseKey: string,
  count: number,
  params?: Record<string, string | number>
): string {
  const rules = new Intl.PluralRules(locale);
  const category = rules.select(count);
  const pluralKey = category === 'one' ? `${baseKey}.one` : `${baseKey}.other`;
  const merged = { ...params, count };
  const template = getMessage(locale, pluralKey);
  return format(template, merged);
}

export function connectionErrorMessage(
  kind: 'connect' | 'build' | null
): string | null {
  if (!kind) return null;
  return t(`errors.${kind}`);
}

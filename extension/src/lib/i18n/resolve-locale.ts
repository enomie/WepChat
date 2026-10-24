export type SupportedLocale = 'en' | 'de';

const SUPPORTED: SupportedLocale[] = ['de', 'en'];

export function resolveLocale(languages?: readonly string[]): SupportedLocale {
  const list = languages?.length ? languages : ['en'];
  for (const raw of list) {
    const tag = raw.trim().split('-')[0]?.toLowerCase();
    if (tag === 'de' || tag === 'en') {
      return tag;
    }
  }
  return 'en';
}

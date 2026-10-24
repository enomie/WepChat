export const DEFAULT_NICK_COLOR_ID = 1;

export type NickColorKey =
  | 'blue'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'violet'
  | 'pink'
  | 'brown'
  | 'turquoise';

export interface NickColorDef {
  id: number;
  key: NickColorKey;
  hex: string;
}

export const NICK_COLORS: readonly NickColorDef[] = [
  { id: 1, key: 'blue', hex: '#014D9E' },
  { id: 2, key: 'red', hex: '#9E0F23' },
  { id: 3, key: 'orange', hex: '#DF6F04' },
  { id: 4, key: 'yellow', hex: '#D9A406' },
  { id: 5, key: 'green', hex: '#167849' },
  { id: 6, key: 'violet', hex: '#613AA9' },
  { id: 7, key: 'pink', hex: '#BC2D74' },
  { id: 8, key: 'brown', hex: '#7D5127' },
  { id: 9, key: 'turquoise', hex: '#1CB185' },
];

const BY_ID = new Map(NICK_COLORS.map((c) => [c.id, c]));

export function normalizeNickColorId(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 9) return n;
  return DEFAULT_NICK_COLOR_ID;
}

export function nickColorById(id: number): NickColorDef {
  return BY_ID.get(normalizeNickColorId(id)) ?? NICK_COLORS[0]!;
}

export function nickColorStyles(id: number): {
  senderColor: string;
  bubbleBackground: string;
} {
  const hex = nickColorById(id).hex;
  return {
    senderColor: hex,
    bubbleBackground: `color-mix(in srgb, ${hex} 14%, white)`,
  };
}

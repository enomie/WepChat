import { DEFAULT_NICK_COLOR_ID, normalizeNickColorId } from './nick-colors';
import { prepareUsername } from './message-text-policy';

export interface Profile {
  username: string;
  nickColorId: number;
}

const defaultProfile: Profile = {
  username: 'Anon' + Math.floor(1000 + Math.random() * 9000),
  nickColorId: DEFAULT_NICK_COLOR_ID,
};

export function migrateStoredProfile(stored: Record<string, unknown>): Profile {
  const rawUsername = typeof stored.username === 'string' ? stored.username : '';
  const cleaned = prepareUsername(rawUsername);
  const username = cleaned || defaultProfile.username;
  const nickColorId = normalizeNickColorId(stored.nickColorId);
  return { username, nickColorId };
}

export function createProfileState() {
  let profile = $state<Profile>({ ...defaultProfile });

  if (typeof browser !== 'undefined' && browser.storage?.local) {
    browser.storage.local.get('userProfile').then((res) => {
      if (res.userProfile && typeof res.userProfile === 'object') {
        const migrated = migrateStoredProfile(res.userProfile as Record<string, unknown>);
        profile = migrated;
        browser.storage.local.set({ userProfile: $state.snapshot(profile) });
      } else {
        browser.storage.local.set({ userProfile: defaultProfile });
      }
    });
  }

  async function persist() {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ userProfile: $state.snapshot(profile) });
    }
  }

  async function setUsername(newUsername: string) {
    const prepared = prepareUsername(newUsername);
    if (!prepared) return;
    profile.username = prepared;
    await persist();
  }

  async function setNickColorId(id: number) {
    profile.nickColorId = normalizeNickColorId(id);
    await persist();
  }

  return {
    get current() {
      return profile;
    },
    setUsername,
    setNickColorId,
  };
}

export const profileState = createProfileState();

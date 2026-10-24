import { prepareUsername } from './message-text-policy';

export interface Profile {
  username: string;
  avatarColor: string;
}

const defaultProfile: Profile = {
  username: 'Anon' + Math.floor(1000 + Math.random() * 9000),
  avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16),
};

export function createProfileState() {
  let profile = $state<Profile>({ ...defaultProfile });

  if (typeof browser !== 'undefined' && browser.storage?.local) {
    browser.storage.local.get('userProfile').then((res) => {
      if (res.userProfile) {
        const stored = res.userProfile as Profile;
        const cleaned = prepareUsername(stored.username);
        profile = cleaned
          ? { ...stored, username: cleaned }
          : { ...stored, username: defaultProfile.username };
        if (cleaned !== stored.username) {
          browser.storage.local.set({ userProfile: $state.snapshot(profile) });
        }
      } else {
        browser.storage.local.set({ userProfile: defaultProfile });
      }
    });
  }

  async function setUsername(newUsername: string) {
    const prepared = prepareUsername(newUsername);
    if (!prepared) return;
    profile.username = prepared;
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ userProfile: $state.snapshot(profile) });
    }
  }

  return {
    get current() {
      return profile;
    },
    setUsername,
  };
}

export const profileState = createProfileState();

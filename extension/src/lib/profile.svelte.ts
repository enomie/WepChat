export interface Profile {
  username: string;
  avatarColor: string;
}

const defaultProfile: Profile = {
  username: 'Anon_' + Math.floor(1000 + Math.random() * 9000),
  avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16),
};

export function createProfileState() {
  let profile = $state<Profile>({ ...defaultProfile });

  if (typeof browser !== 'undefined' && browser.storage?.local) {
    browser.storage.local.get('userProfile').then((res) => {
      if (res.userProfile) {
        profile = res.userProfile as Profile;
      } else {
        browser.storage.local.set({ userProfile: defaultProfile });
      }
    });
  }

  async function setUsername(newUsername: string) {
    const trimmed = newUsername.trim();
    if (!trimmed) return;
    profile.username = trimmed;
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

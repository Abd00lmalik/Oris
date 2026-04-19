"use client";

export interface UserProfile {
  address: string;
  username: string;
  avatarUrl: string;
  avatarDataUri?: string;
  updatedAt: number;
}

type SaveProfileResult = {
  success: boolean;
  error?: string;
};

const STORAGE_KEY = "archon_profiles";

function loadProfiles(): Record<string, UserProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserProfile>) : {};
  } catch {
    return {};
  }
}

function saveProfiles(profiles: Record<string, UserProfile>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Ignore quota/storage errors for non-critical profile cache.
  }
}

export function getProfile(address: string): UserProfile | null {
  if (!address) return null;
  const profiles = loadProfiles();
  return profiles[address.toLowerCase()] ?? null;
}

export function isUsernameTaken(username: string, excludeAddress?: string): boolean {
  if (!username.trim()) return false;
  const profiles = loadProfiles();
  const normalized = username.trim().toLowerCase();
  const excluded = excludeAddress?.toLowerCase() ?? "";
  return Object.values(profiles).some((profile) => {
    return (
      profile.username?.trim().toLowerCase() === normalized &&
      profile.address.toLowerCase() !== excluded
    );
  });
}

export function saveProfile(profile: UserProfile): SaveProfileResult {
  if (!profile.address) return { success: false, error: "Wallet address is required" };

  const username = profile.username?.trim() ?? "";
  if (username) {
    if (username.length < 2) {
      return { success: false, error: "Username must be at least 2 characters" };
    }
    if (username.length > 32) {
      return { success: false, error: "Username must be 32 characters or less" };
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return {
        success: false,
        error: "Username can only contain letters, numbers, _, ., -"
      };
    }
    if (isUsernameTaken(username, profile.address)) {
      return { success: false, error: `Username "${username}" is already taken` };
    }
  }

  const profiles = loadProfiles();
  profiles[profile.address.toLowerCase()] = {
    ...profile,
    username,
    updatedAt: Date.now()
  };
  saveProfiles(profiles);
  return { success: true };
}

export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function fetchUserProfile(_provider: unknown, address: string): Promise<UserProfile | null> {
  return getProfile(address);
}

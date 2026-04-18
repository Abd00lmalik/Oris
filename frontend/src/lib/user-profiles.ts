"use client";

export interface UserProfile {
  address: string;
  username: string;
  avatarUrl: string;
  avatarDataUri?: string;
  updatedAt: number;
}

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

export function saveProfile(profile: UserProfile): void {
  if (!profile.address) return;
  const profiles = loadProfiles();
  profiles[profile.address.toLowerCase()] = {
    ...profile,
    updatedAt: Date.now()
  };
  saveProfiles(profiles);
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

export interface ResultWithExpiry {
  expires_at: number | null;
}

export interface LiveCardState {
  expires_at?: unknown;
}

/**
 * Merge mutable server-side card state into the result cached by the browser.
 */
export function mergeLiveCardExpiry<T extends ResultWithExpiry>(
  current: T,
  live: LiveCardState
): T {
  if (!Object.prototype.hasOwnProperty.call(live, 'expires_at')) {
    return current;
  }

  const expiresAt = live.expires_at;
  if (expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt))) {
    return current;
  }
  if (current.expires_at === expiresAt) {
    return current;
  }

  return { ...current, expires_at: expiresAt };
}

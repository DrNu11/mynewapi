import { describe, expect, it, vi } from 'vitest';

import { CardExpiryLocalUpdateError, syncCardExpiry } from './card-expiry-sync';

describe('card expiry synchronization', () => {
  it('maps permanent expiry to NewAPI -1 and local null', async () => {
    const updateRemote = vi.fn(async () => ({ before: 1_800_000_000, after: -1 }));
    const updateLocal = vi.fn(() => ({ code: 'GL-TEST', expires_at: null }));

    const result = await syncCardExpiry(
      { code: 'GL-TEST', tokenId: 123, expiresAt: null },
      { updateRemote, updateLocal },
    );

    expect(updateRemote).toHaveBeenCalledWith(123, -1);
    expect(updateLocal).toHaveBeenCalledWith('GL-TEST', null);
    expect(result.card).toEqual({ code: 'GL-TEST', expires_at: null });
  });

  it('rolls NewAPI back when the local card update fails', async () => {
    const updateRemote = vi
      .fn()
      .mockResolvedValueOnce({ before: 1_800_000_000, after: -1 })
      .mockResolvedValueOnce({ before: -1, after: 1_800_000_000 });
    const updateLocal = vi.fn(() => null);

    await expect(
      syncCardExpiry(
        { code: 'GL-TEST', tokenId: 123, expiresAt: null },
        { updateRemote, updateLocal },
      ),
    ).rejects.toBeInstanceOf(CardExpiryLocalUpdateError);

    expect(updateRemote).toHaveBeenNthCalledWith(2, 123, 1_800_000_000);
  });
});

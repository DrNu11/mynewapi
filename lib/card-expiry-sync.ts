export interface CardExpirySyncInput {
  code: string;
  tokenId: number;
  /** 本地 cards.expires_at；null 表示永久有效。 */
  expiresAt: number | null;
}

export interface CardExpirySyncDeps<CardType> {
  updateRemote: (
    tokenId: number,
    expiresAt: number,
  ) => Promise<{ before: number; after: number }>;
  updateLocal: (
    code: string,
    expiresAt: number | null,
  ) => CardType | null | Promise<CardType | null>;
}

export class CardExpiryLocalUpdateError extends Error {
  constructor(
    message: string,
    public readonly rollbackSucceeded: boolean,
  ) {
    super(message);
    this.name = 'CardExpiryLocalUpdateError';
  }
}

/**
 * 同步 NewAPI 与本地卡密到期时间。
 * NewAPI 用 -1 表示永久，本地 SQLite 用 null 表示永久。
 */
export async function syncCardExpiry<CardType>(
  input: CardExpirySyncInput,
  deps: CardExpirySyncDeps<CardType>,
): Promise<{ card: CardType; beforeNewApiExpiresAt: number }> {
  const remoteExpiresAt = input.expiresAt === null ? -1 : input.expiresAt;
  const remote = await deps.updateRemote(input.tokenId, remoteExpiresAt);

  try {
    const card = await deps.updateLocal(input.code, input.expiresAt);
    if (!card) throw new Error('修改后读取卡密失败');
    return { card, beforeNewApiExpiresAt: remote.before };
  } catch (localError) {
    let rollbackSucceeded = false;
    try {
      await deps.updateRemote(input.tokenId, remote.before);
      rollbackSucceeded = true;
    } catch {
      // 由调用层记录和告警；错误对象明确携带回滚状态。
    }
    const message = localError instanceof Error ? localError.message : String(localError);
    throw new CardExpiryLocalUpdateError(message, rollbackSucceeded);
  }
}

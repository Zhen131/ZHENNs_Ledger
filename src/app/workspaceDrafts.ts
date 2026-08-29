export type TradeWorkspaceDraft = {
  type: "buy" | "sell";
  assetSymbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  totalValueMode: "auto" | "manual";
  occurredAt: string;
  fee: string;
  feeCurrency: string;
  platform: string;
  note: string;
  noteExpanded: boolean;
};

export type PriceWorkspaceDraft = {
  assetSymbol: string;
  price: string;
  recordedAt: string;
  note: string;
};

export function createTradeWorkspaceDraft(
  assetSymbol: string,
  todayKey: string,
): TradeWorkspaceDraft {
  return {
    type: "buy",
    assetSymbol,
    quantity: "",
    price: "",
    totalValue: "",
    totalValueMode: "auto",
    occurredAt: todayKey,
    fee: "0",
    feeCurrency: "USDT",
    platform: "",
    note: "",
    noteExpanded: false,
  };
}

export function createPriceWorkspaceDraft(
  assetSymbol: string,
  todayKey: string,
): PriceWorkspaceDraft {
  return {
    assetSymbol,
    price: "",
    recordedAt: todayKey,
    note: "",
  };
}

export function workspaceDraftsHaveUserInput(
  tradeDraft: TradeWorkspaceDraft,
  priceDraft: PriceWorkspaceDraft,
): boolean {
  return tradeDraftHasUserInput(tradeDraft) || priceDraftHasUserInput(priceDraft);
}

function tradeDraftHasUserInput(draft: TradeWorkspaceDraft): boolean {
  return (
    draft.type !== "buy" ||
    draft.quantity !== "" ||
    draft.price !== "" ||
    draft.totalValue !== "" ||
    draft.totalValueMode !== "auto" ||
    draft.fee !== "0" ||
    draft.feeCurrency !== "USDT" ||
    draft.platform !== "" ||
    draft.note !== "" ||
    draft.noteExpanded
  );
}

function priceDraftHasUserInput(draft: PriceWorkspaceDraft): boolean {
  return draft.price !== "" || draft.note !== "";
}

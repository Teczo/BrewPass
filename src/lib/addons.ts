/**
 * Add-on catalogue — confirmed business decisions (2026-06-12).
 * Like the plan catalogue, this is the single source of truth: clients
 * send keys only; names and prices are always resolved server-side.
 * Charged off-session at cutoff to the card saved at subscription
 * checkout — never bundled into the prepaid coffee quota.
 */

export interface AddOnDefinition {
  key: string;
  name: string;
  priceSen: number;
  kind: "pastry" | "drink";
}

export const ADD_ONS: Record<string, AddOnDefinition> = {
  butter_croissant: {
    key: "butter_croissant",
    name: "Butter Croissant",
    priceSen: 800,
    kind: "pastry",
  },
  pain_au_chocolat: {
    key: "pain_au_chocolat",
    name: "Pain au Chocolat",
    priceSen: 900,
    kind: "pastry",
  },
  banana_bread: {
    key: "banana_bread",
    name: "Banana Bread",
    priceSen: 700,
    kind: "pastry",
  },
  choc_chip_cookie: {
    key: "choc_chip_cookie",
    name: "Chocolate Chip Cookie",
    priceSen: 500,
    kind: "pastry",
  },
  iced_matcha_latte: {
    key: "iced_matcha_latte",
    name: "Iced Matcha Latte",
    priceSen: 1200,
    kind: "drink",
  },
  spanish_latte: {
    key: "spanish_latte",
    name: "Spanish Latte",
    priceSen: 1100,
    kind: "drink",
  },
};

export const ADD_ON_LIST = Object.values(ADD_ONS);

export interface AddOnSnapshot {
  key: string;
  name: string;
  priceSen: number;
}

/** Resolve client-sent keys to immutable snapshots; null if any key is unknown. */
export function resolveAddOns(keys: string[]): AddOnSnapshot[] | null {
  const unique = [...new Set(keys)];
  const snapshots: AddOnSnapshot[] = [];
  for (const key of unique) {
    const addOn = ADD_ONS[key];
    if (!addOn) return null;
    snapshots.push({ key: addOn.key, name: addOn.name, priceSen: addOn.priceSen });
  }
  return snapshots;
}

export function addOnsTotalSen(addOns: AddOnSnapshot[]): number {
  return addOns.reduce((total, addOn) => total + addOn.priceSen, 0);
}

/**
 * Client-safe option shapes for the preference/order forms. No database or
 * server imports here, so client components can pull the types and the
 * built-in defaults. The server builds the live lists from the taxonomy
 * (see drinkOptionsFrom in taxonomy.ts) and passes them as props.
 */

export interface Option {
  value: string;
  label: string;
}

export interface DrinkOptions {
  drinks: Option[];
  sizes: Option[];
  milks: Option[];
  strengths: Option[];
}

const asOptions = (values: string[]): Option[] => values.map((value) => ({ value, label: value }));
const labelled = (pairs: Array<[string, string]>): Option[] =>
  pairs.map(([value, label]) => ({ value, label }));

/** Mirrors the v1 hard-coded lists; used only as a fallback when a page
 * doesn't pass taxonomy-derived options (e.g. before the seed runs). */
export const DEFAULT_DRINK_OPTIONS: DrinkOptions = {
  drinks: asOptions([
    "Flat White",
    "Latte",
    "Cappuccino",
    "Americano",
    "Long Black",
    "Mocha",
    "Espresso",
    "Cold Brew",
  ]),
  sizes: labelled([
    ["small", "Small"],
    ["regular", "Regular"],
    ["large", "Large"],
  ]),
  milks: asOptions(["Fresh milk", "Oat", "Almond", "Soy", "None"]),
  strengths: labelled([
    ["mild", "Mild"],
    ["regular", "Regular"],
    ["strong", "Strong"],
    ["double", "Double"],
  ]),
};

/**
 * Guarantee `value` appears in the option list. A saved preference may
 * reference an option the active taxonomy no longer offers; surfacing it
 * keeps the form from silently switching the user's choice on edit.
 */
export function ensureOption(options: Option[], value: string): Option[] {
  if (!value || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: value }];
}

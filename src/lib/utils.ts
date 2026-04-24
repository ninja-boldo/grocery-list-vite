import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Item } from "@/App";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Tag normalisation ─────────────────────────────────────────────────────────
// Open Food Facts (OFF) returns raw English category slugs or space-separated
// strings. Map known values to human-readable German display names before they
// reach the UI. Keys are lower-cased and trimmed before lookup.
const TAG_NORMALIZATION_MAP: Record<string, string> = {
  // Fruit & Veg
  "fruit":                          "Früchte & Gemüse",
  "fruits":                         "Früchte & Gemüse",
  "vegetable":                      "Früchte & Gemüse",
  "vegetables":                     "Früchte & Gemüse",
  "fruit vegetables":               "Früchte & Gemüse",
  "fruits and vegetables":          "Früchte & Gemüse",
  "fresh fruits":                   "Früchte & Gemüse",
  "fresh vegetables":               "Früchte & Gemüse",
  "plant-based foods":              "Früchte & Gemüse",
  "plant-based foods and beverages":"Früchte & Gemüse",
  // Dairy
  "dairy":                          "Milchprodukte",
  "dairies":                        "Milchprodukte",
  "dairy product":                  "Milchprodukte",
  "dairy products":                 "Milchprodukte",
  "milk":                           "Milchprodukte",
  "milks":                          "Milchprodukte",
  "cheese":                         "Milchprodukte",
  "cheeses":                        "Milchprodukte",
  "yogurt":                         "Milchprodukte",
  "yogurts":                        "Milchprodukte",
  "fermented milk products":        "Milchprodukte",
  // Meat & Fish
  "meat":                           "Fleisch & Fisch",
  "meats":                          "Fleisch & Fisch",
  "fish":                           "Fleisch & Fisch",
  "seafood":                        "Fleisch & Fisch",
  "poultry":                        "Fleisch & Fisch",
  "beef":                           "Fleisch & Fisch",
  "pork":                           "Fleisch & Fisch",
  "sausage":                        "Fleisch & Fisch",
  "sausages":                       "Fleisch & Fisch",
  "deli meats":                     "Fleisch & Fisch",
  "processed meats":                "Fleisch & Fisch",
  // Bakery
  "bread":                          "Brot & Backwaren",
  "breads":                         "Brot & Backwaren",
  "bakery":                         "Brot & Backwaren",
  "pastry":                         "Brot & Backwaren",
  "pastries":                       "Brot & Backwaren",
  "cereals":                        "Brot & Backwaren",
  "cereal":                         "Brot & Backwaren",
  "grain":                          "Brot & Backwaren",
  "grains":                         "Brot & Backwaren",
  // Beverages
  "beverage":                       "Getränke",
  "beverages":                      "Getränke",
  "drink":                          "Getränke",
  "drinks":                         "Getränke",
  "juice":                          "Getränke",
  "juices":                         "Getränke",
  "water":                          "Getränke",
  "waters":                         "Getränke",
  "soft drink":                     "Getränke",
  "soft drinks":                    "Getränke",
  "sodas":                          "Getränke",
  "non-alcoholic beverages":        "Getränke",
  "alcoholic beverages":            "Getränke",
  "beer":                           "Getränke",
  "wine":                           "Getränke",
  // Snacks & Sweets
  "snack":                          "Snacks & Süßes",
  "snacks":                         "Snacks & Süßes",
  "sweet":                          "Snacks & Süßes",
  "sweets":                         "Snacks & Süßes",
  "chocolate":                      "Snacks & Süßes",
  "chocolates":                     "Snacks & Süßes",
  "candy":                          "Snacks & Süßes",
  "candies":                        "Snacks & Süßes",
  "cookies":                        "Snacks & Süßes",
  "biscuits":                       "Snacks & Süßes",
  "chips":                          "Snacks & Süßes",
  "crisps":                         "Snacks & Süßes",
  // Frozen
  "frozen":                         "Tiefkühl",
  "frozen food":                    "Tiefkühl",
  "frozen foods":                   "Tiefkühl",
  "frozen meals":                   "Tiefkühl",
  "frozen vegetables":              "Tiefkühl",
  "ice cream":                      "Tiefkühl",
  // Pantry / Dry goods
  "pasta":                          "Vorratskammer",
  "rice":                           "Vorratskammer",
  "legume":                         "Vorratskammer",
  "legumes":                        "Vorratskammer",
  "condiment":                      "Vorratskammer",
  "condiments":                     "Vorratskammer",
  "sauce":                          "Vorratskammer",
  "sauces":                         "Vorratskammer",
  "oil":                            "Vorratskammer",
  "oils":                           "Vorratskammer",
  "vinegar":                        "Vorratskammer",
  "spice":                          "Vorratskammer",
  "spices":                         "Vorratskammer",
  "seasoning":                      "Vorratskammer",
  "canned food":                    "Vorratskammer",
  "canned foods":                   "Vorratskammer",
  "preserved foods":                "Vorratskammer",
  // Convenience / Ready meals
  "ready meal":                     "Fertiggerichte",
  "ready meals":                    "Fertiggerichte",
  "prepared meal":                  "Fertiggerichte",
  "prepared meals":                 "Fertiggerichte",
  "convenience food":               "Fertiggerichte",
  "convenience foods":              "Fertiggerichte",
  // Personal care / Non-food
  "hygiene":                        "Körperpflege",
  "personal care":                  "Körperpflege",
  "cosmetics":                      "Körperpflege",
  "household":                      "Haushalt",
  "cleaning":                       "Haushalt",
  "cleaning products":              "Haushalt",
  "baby":                           "Baby",
  "baby food":                      "Baby",
  "pet food":                       "Tierfutter",
};

const normalizeTag = (raw: string): string => {
  const key = raw.toLowerCase().trim();
  return TAG_NORMALIZATION_MAP[key] ?? raw;
};

export const transformItems = (data: ApiResponse): Item[] => {
  return data.items.map((item) => {
    const rawTags = (item.tags ?? "").toString().trim();

    // Attempt whole-string lookup first (e.g. "fruit vegetables" → one tag).
    // Then fall back to comma-splitting, then space-splitting.
    let parsedTags: string[];

    if (!rawTags) {
      parsedTags = [];
    } else if (TAG_NORMALIZATION_MAP[rawTags.toLowerCase()]) {
      // Entire string matched as a known multi-word tag
      parsedTags = [TAG_NORMALIZATION_MAP[rawTags.toLowerCase()]];
    } else if (rawTags.includes(",")) {
      parsedTags = rawTags
        .split(",")
        .map((t) => normalizeTag(t))
        .filter(Boolean);
    } else {
      // Space-separated — but first check if the full string is a known phrase
      // (already handled above). Split and normalise each token individually.
      parsedTags = rawTags
        .split(" ")
        .map((t) => normalizeTag(t))
        .filter(Boolean);
    }

    // De-duplicate (e.g. "fruit" + "vegetables" both map to same German label)
    const uniqueTags = [...new Set(parsedTags)];

    return {
      ean: item.ean,
      text: item.text,
      shortened_name: item.shortened_name ?? null,
      classname: uniqueTags[0] ?? null,
      count: item.count,
      perish_dates: item.perish_dates ?? [],
      imageUrl: item.imageUrl,
      tags: uniqueTags,

      mapped_items: item.mapped_items ?? item.mappedItems ?? [],
    };
  });
};

export const PageModes = {
  HomePage: 0,
  WishPage: 1,
  GeoPage: 2,
} as const;
export type PageMode = typeof PageModes[keyof typeof PageModes];

export type MappedItem = {
  count: number;
  item_name: string;
};

export interface ApiItem {
  ean: string;
  text: string;
  shortened_name?: string | null;
  count: number;
  perish_dates: string[] | null;
  imageUrl: string;
  tags: string | null;
  mapped_items?: MappedItem[];
  mappedItems?: MappedItem[];
}

export interface ApiResponse {
  items: ApiItem[];
  /** Total quantity across all wish-list entries (wish list only) */
  accumulated_count?: number;
  /** Number of distinct wish-list entries (wish list only) */
  distinct_items?: number;
}

export interface ApiResponseGroceryOffers {
  name: string;
  shortened_name: string;
  weight_g: string;
  volume_ml: string;
  normal_price: number;
  discount_price: number;
  is_app_offer: string;
  discount_rate?: number;
}

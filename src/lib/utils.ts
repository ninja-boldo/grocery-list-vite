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

    return {
      ean: item.ean,
      text: item.text,
      shortened_name: item.shortened_name ?? null,
      classname: parsedTags[0] ?? null,
      count: item.count,
      perish_dates: item.perish_dates ?? [],
      imageUrl: item.imageUrl,
      tags: parsedTags,

      mapped_items: item.mapped_items ?? item.mappedItems ?? [],

      expiryDays: item.expiryDays ?? null,
    };
  });
};

export const PageModes = Object.freeze({
      HomePage: 0,
      WishPage: 1,
      GeoPage: 2,
});

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
  /** Days until expiry, or -1 if unknown/unavailable */
  expiryDays?: number | null;
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

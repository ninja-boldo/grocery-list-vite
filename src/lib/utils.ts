import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Item } from "@/App";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const transformItems = (data: ApiResponse): Item[] => {
  const transformed = data.items.map((item) => {
    const rawTags = (item.tags ?? "").toString();
    const parsedTags = rawTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    return {
      ean: item.ean,
      text: item.text,
      classname: parsedTags[0] ?? null,
      count: item.count,
      perish_dates: item.perish_dates ?? [],
      imageUrl: item.imageUrl,
      tags: parsedTags,
    };
  });
  
  return transformed;
};



export enum PageModes {
  HomePage,
  WishPage,
  GeoPage,
}

export interface ApiItem {
  ean: string;
  text: string;
  count: number;
  perish_dates: string[] | null;
  imageUrl: string;
  tags: string | null;
}

export interface ApiResponse {
  items: ApiItem[];
}

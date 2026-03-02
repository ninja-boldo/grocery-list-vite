import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Item } from "@/App";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const transformItems = (data: ApiResponse): Item[] => {
  console.log("item.tags:", data.items[0].tags);
  const transformed = data.items.map((item) => ({
    ean: item.ean,
    text: item.text,
    subgroups: item.subgroups,
    classname: item.classname,
    count: item.count,
    perish_dates: item.perish_dates ?? [],
    imageUrl: item.imageUrl,
    tags: item.tags.toString().split(","),
  }));
  
  console.log("item.tags:", transformed[0].tags);
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
  subgroups: string | null;
  classname: string | null;
  count: number;
  perish_dates: string[] | null;
  imageUrl: string;
  tags: string;
}

export interface ApiResponse {
  items: ApiItem[];
}

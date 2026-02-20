export type CarouselColumnId =
  | "cheap_region"
  | "price_drop"
  | "easy_sell"
  | "practical_filter"
  | "ai_store";

export type CarouselColumnConfig = {
  id: CarouselColumnId;
  title: string;
  subtitle: string;
  limit: number;
  visibleCount: 4 | 5;
  emptyMessage: string;
  mode: "data" | "placeholder";
  query: {
    poolSize: number;
  };
};

export const EASY_SELL_RULES = {
  minBedrooms: 2,
  minPrice: 250000,
  maxPrice: 700000,
  minAreaM2: 45,
  maxAreaM2: 90,
  applyAreaRangeWhenPresent: true
} as const;

export const CAROUSEL_COLUMNS: readonly CarouselColumnConfig[] = [
  {
    id: "cheap_region",
    title: "Barato na região",
    subtitle: "Oportunidades",
    limit: 30,
    visibleCount: 4,
    emptyMessage: "Sem oportunidades suficientes para a região no momento.",
    mode: "data",
    query: { poolSize: 260 }
  },
  {
    id: "price_drop",
    title: "Queda de preço",
    subtitle: "Price drop",
    limit: 30,
    visibleCount: 4,
    emptyMessage: "Ainda não detectamos quedas de preço suficientes",
    mode: "data",
    query: { poolSize: 260 }
  },
  {
    id: "easy_sell",
    title: "Fácil de vender",
    subtitle: "Saída rápida",
    limit: 30,
    visibleCount: 4,
    emptyMessage: "Sem imóveis suficientes dentro dos critérios de saída rápida.",
    mode: "data",
    query: { poolSize: 260 }
  },
  {
    id: "practical_filter",
    title: "Filtro prático",
    subtitle: "Curadoria rápida",
    limit: 30,
    visibleCount: 4,
    emptyMessage: "Sem imóveis suficientes no filtro prático no momento.",
    mode: "data",
    query: { poolSize: 260 }
  },
  {
    id: "ai_store",
    title: "IA / Store",
    subtitle: "Em breve",
    limit: 0,
    visibleCount: 4,
    emptyMessage: "Em breve: Store / curadoria IA",
    mode: "placeholder",
    query: { poolSize: 0 }
  }
] as const;

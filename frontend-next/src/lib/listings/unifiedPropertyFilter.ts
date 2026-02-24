import { normalizeText } from "@/lib/format/text";

export type UnifiedPropertyCategory =
  | "apartment"
  | "house"
  | "casa_condominio"
  | "terreno"
  | "galpao"
  | "salao"
  | "sala"
  | "loja"
  | "laje"
  | "ponto_comercial"
  | "casa_comercial"
  | "predio_comercial"
  | "chacara"
  | "sitio"
  | "other";

export type ListingPropertyLike = {
  property_type?: string | null;
  property_subtype?: string | null;
};

export const UNIFIED_PROPERTY_OPTIONS: Array<{
  value: UnifiedPropertyCategory;
  label: string;
}> = [
  { value: "apartment", label: "Apartamento" },
  { value: "house", label: "Casa" },
  { value: "casa_condominio", label: "Casa de Condomínio" },
  { value: "terreno", label: "Terreno" },
  { value: "galpao", label: "Galpão" },
  { value: "salao", label: "Salão" },
  { value: "sala", label: "Sala" },
  { value: "loja", label: "Loja" },
  { value: "laje", label: "Laje" },
  { value: "ponto_comercial", label: "Ponto comercial" },
  { value: "casa_comercial", label: "Casa comercial" },
  { value: "predio_comercial", label: "Prédio comercial" },
  { value: "chacara", label: "Chácara" },
  { value: "sitio", label: "Sítio" },
  { value: "other", label: "Outros" }
];

export const PROPERTY_CATEGORY_OPTIONS = UNIFIED_PROPERTY_OPTIONS;

const UNIFIED_PROPERTY_LABELS: Record<UnifiedPropertyCategory, string> = {
  apartment: "Apartamento",
  house: "Casa",
  casa_condominio: "Casa de Condomínio",
  terreno: "Terreno",
  galpao: "Galpão",
  salao: "Salão",
  sala: "Sala",
  loja: "Loja",
  laje: "Laje",
  ponto_comercial: "Ponto comercial",
  casa_comercial: "Casa comercial",
  predio_comercial: "Prédio comercial",
  chacara: "Chácara",
  sitio: "Sítio",
  other: "Outros"
};

type DbPropertyTypeNormalized = "apartment" | "house" | "other" | "land" | null;
type DbPropertySubtypeNormalized =
  | "casa_condominio"
  | "terreno"
  | "galpao"
  | "salao"
  | "sala"
  | "loja"
  | "laje"
  | "ponto_comercial"
  | "casa_comercial"
  | "predio_comercial"
  | "chacara"
  | "sitio"
  | "other"
  | null;

const normalizeDbPropertyType = (value?: string | null): DbPropertyTypeNormalized => {
  const normalized = normalizeText(value ?? "");
  if (!normalized) return null;
  if (normalized === "apartment" || normalized === "apartamento") return "apartment";
  if (normalized === "house" || normalized === "casa") return "house";
  if (normalized === "other" || normalized === "outro" || normalized === "outros") return "other";
  if (normalized === "land" || normalized === "terreno") return "land";
  return null;
};

const normalizeDbPropertySubtype = (value?: string | null): DbPropertySubtypeNormalized => {
  const normalized = normalizeText(value ?? "");
  if (!normalized) return null;

  if (
    normalized === "casa_condominio" ||
    normalized === "casa condominio" ||
    normalized === "casa de condominio" ||
    normalized === "condominio"
  ) {
    return "casa_condominio";
  }

  if (normalized === "terreno" || normalized === "land") return "terreno";
  if (normalized === "galpao" || normalized === "barracao") return "galpao";
  if (normalized === "salao") return "salao";
  if (normalized === "sala") return "sala";
  if (normalized === "loja") return "loja";
  if (normalized === "laje") return "laje";

  if (normalized === "ponto_comercial" || normalized === "ponto comercial") {
    return "ponto_comercial";
  }
  if (normalized === "casa_comercial" || normalized === "casa comercial") {
    return "casa_comercial";
  }
  if (
    normalized === "predio_comercial" ||
    normalized === "predio comercial" ||
    normalized === "predio"
  ) {
    return "predio_comercial";
  }

  if (normalized === "chacara") return "chacara";
  if (normalized === "sitio") return "sitio";

  if (normalized === "other" || normalized === "outro" || normalized === "outros") {
    return "other";
  }

  return null;
};

export const normalizeUnifiedPropertyCategory = (
  value?: string | null
): UnifiedPropertyCategory | null => {
  const normalized = normalizeText(value ?? "");
  if (!normalized) return null;

  if (normalized === "apartment" || normalized === "apartamento") return "apartment";
  if (normalized === "house" || normalized === "casa") return "house";
  if (
    normalized === "casa_condominio" ||
    normalized === "casa condominio" ||
    normalized === "casa de condominio" ||
    normalized === "condominio"
  ) {
    return "casa_condominio";
  }
  if (normalized === "terreno" || normalized === "land") return "terreno";
  if (normalized === "galpao" || normalized === "barracao") return "galpao";
  if (normalized === "salao") return "salao";
  if (normalized === "sala") return "sala";
  if (normalized === "loja") return "loja";
  if (normalized === "laje") return "laje";
  if (normalized === "ponto_comercial" || normalized === "ponto comercial") {
    return "ponto_comercial";
  }
  if (normalized === "casa_comercial" || normalized === "casa comercial") {
    return "casa_comercial";
  }
  if (
    normalized === "predio_comercial" ||
    normalized === "predio comercial" ||
    normalized === "predio"
  ) {
    return "predio_comercial";
  }
  if (normalized === "chacara") return "chacara";
  if (normalized === "sitio") return "sitio";
  if (normalized === "other" || normalized === "outro" || normalized === "outros") {
    return "other";
  }

  return null;
};

export const normalizeUnifiedPropertyCategories = (
  values?: Array<string | null | undefined> | null
) => {
  const unique = new Set<UnifiedPropertyCategory>();
  (values ?? []).forEach((value) => {
    const normalized = normalizeUnifiedPropertyCategory(value);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
};

export const getUnifiedPropertyCategoryFromListing = (
  listing?: ListingPropertyLike | null
): UnifiedPropertyCategory => {
  const type = normalizeDbPropertyType(listing?.property_type);
  const subtype = normalizeDbPropertySubtype(listing?.property_subtype);

  if (type === "apartment") return "apartment";

  if (type === "house") {
    if (subtype === "casa_condominio") return "casa_condominio";
    return "house";
  }

  if (type === "land") return "terreno"; // legacy compatibility

  if (subtype === "terreno") return "terreno";
  if (subtype === "galpao") return "galpao";
  if (subtype === "salao") return "salao";
  if (subtype === "sala") return "sala";
  if (subtype === "loja") return "loja";
  if (subtype === "laje") return "laje";
  if (subtype === "ponto_comercial") return "ponto_comercial";
  if (subtype === "casa_comercial") return "casa_comercial";
  if (subtype === "predio_comercial") return "predio_comercial";
  if (subtype === "chacara") return "chacara";
  if (subtype === "sitio") return "sitio";

  return "other";
};

export const getUnifiedPropertyCategoryLabel = (value?: string | null) => {
  const normalized = normalizeUnifiedPropertyCategory(value);
  return normalized ? UNIFIED_PROPERTY_LABELS[normalized] : "Outros";
};

export const getUnifiedPropertyLabelForListing = (listing?: ListingPropertyLike | null) =>
  UNIFIED_PROPERTY_LABELS[getUnifiedPropertyCategoryFromListing(listing)];

export const isTerrenoListing = (listing?: ListingPropertyLike | null) =>
  getUnifiedPropertyCategoryFromListing(listing) === "terreno";

const listingMatchesSingleUnifiedCategory = (
  listing: ListingPropertyLike,
  selected: UnifiedPropertyCategory
) => {
  const type = normalizeDbPropertyType(listing.property_type);
  const subtype = normalizeDbPropertySubtype(listing.property_subtype);

  if (selected === "apartment") return type === "apartment";
  if (selected === "house") return type === "house";
  if (selected === "casa_condominio") {
    return type === "house" && subtype === "casa_condominio";
  }
  if (selected === "terreno") {
    return type === "land" || (type === "other" && subtype === "terreno");
  }
  if (selected === "galpao") return type === "other" && subtype === "galpao";
  if (selected === "salao") return type === "other" && subtype === "salao";
  if (selected === "sala") return type === "other" && subtype === "sala";
  if (selected === "loja") return type === "other" && subtype === "loja";
  if (selected === "laje") return type === "other" && subtype === "laje";
  if (selected === "ponto_comercial") {
    return type === "other" && subtype === "ponto_comercial";
  }
  if (selected === "casa_comercial") {
    return type === "other" && subtype === "casa_comercial";
  }
  if (selected === "predio_comercial") {
    return type === "other" && subtype === "predio_comercial";
  }
  if (selected === "chacara") return type === "other" && subtype === "chacara";
  if (selected === "sitio") return type === "other" && subtype === "sitio";

  return type === "other" && (subtype === "other" || subtype === null);
};

export const matchesUnifiedPropertyFilter = (
  listing?: ListingPropertyLike | null,
  selectedValues?: Array<string | null | undefined> | null
) => {
  const normalizedSelected = normalizeUnifiedPropertyCategories(selectedValues);
  if (!listing || normalizedSelected.length === 0) return true;
  return normalizedSelected.some((selected) =>
    listingMatchesSingleUnifiedCategory(listing, selected)
  );
};

const conditionForUnifiedCategory = (
  value: UnifiedPropertyCategory,
  typeColumn: string,
  subtypeColumn: string
) => {
  if (value === "apartment") return `${typeColumn}.eq.apartment`;
  if (value === "house") return `${typeColumn}.eq.house`;
  if (value === "casa_condominio") {
    return `and(${typeColumn}.eq.house,${subtypeColumn}.eq.casa_condominio)`;
  }
  if (value === "terreno") {
    return `or(${typeColumn}.eq.land,and(${typeColumn}.eq.other,${subtypeColumn}.eq.terreno))`;
  }
  if (value === "galpao") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.galpao)`;
  }
  if (value === "salao") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.salao)`;
  }
  if (value === "sala") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.sala)`;
  }
  if (value === "loja") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.loja)`;
  }
  if (value === "laje") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.laje)`;
  }
  if (value === "ponto_comercial") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.ponto_comercial)`;
  }
  if (value === "casa_comercial") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.casa_comercial)`;
  }
  if (value === "predio_comercial") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.predio_comercial)`;
  }
  if (value === "chacara") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.chacara)`;
  }
  if (value === "sitio") {
    return `and(${typeColumn}.eq.other,${subtypeColumn}.eq.sitio)`;
  }
  return `and(${typeColumn}.eq.other,or(${subtypeColumn}.eq.other,${subtypeColumn}.is.null))`;
};

export const buildUnifiedPropertySupabaseOrFilter = (
  selectedValues?: Array<string | null | undefined> | null,
  columns: { propertyType?: string; propertySubtype?: string } = {}
) => {
  const normalizedSelected = normalizeUnifiedPropertyCategories(selectedValues);
  if (normalizedSelected.length === 0) return null;

  const propertyTypeColumn = columns.propertyType ?? "property_type";
  const propertySubtypeColumn = columns.propertySubtype ?? "property_subtype";

  return normalizedSelected
    .map((value) =>
      conditionForUnifiedCategory(value, propertyTypeColumn, propertySubtypeColumn)
    )
    .join(",");
};

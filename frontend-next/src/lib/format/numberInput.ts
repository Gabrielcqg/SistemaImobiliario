export function formatThousandsBR(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  const number = Number(digits);
  if (!Number.isFinite(number)) return "";
  return new Intl.NumberFormat("pt-BR").format(number);
}

export function parseBRNumber(value: string): number | null {
  const cleaned = value.replace(/\s/g, "");
  if (!cleaned) return null;

  const normalized = cleaned
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");

  if (!normalized || normalized === "." || normalized === "-" || normalized === "-.") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

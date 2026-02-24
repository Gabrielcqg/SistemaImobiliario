import Card from "@/components/ui/Card";
import ListingCard from "@/components/radar/ListingCard";
import type { Listing } from "@/hooks/useListings";
import type { CaptureCandidate } from "@/lib/ai/types";

type CaptureCandidatesPanelProps = {
  candidates: CaptureCandidate[];
};

const categoryLabel = (category: CaptureCandidate["category"]) => {
  if (category === "below_market") return "Barato na região";
  if (category === "price_drop") return "Queda de preço";
  return "Recente";
};

const toListing = (candidate: CaptureCandidate): Listing => ({
  id: candidate.id,
  title: candidate.title,
  price: candidate.price,
  city: candidate.city,
  state: candidate.state,
  neighborhood: candidate.neighborhood,
  neighborhood_normalized: candidate.neighborhood,
  bedrooms: candidate.bedrooms,
  bathrooms: candidate.bathrooms,
  parking: candidate.parking,
  area_m2: candidate.area_m2,
  deal_type: null,
  property_type: candidate.property_type,
  portal: candidate.portal,
  first_seen_at: candidate.first_seen_at,
  main_image_url: candidate.main_image_url,
  url: candidate.url
});

export default function CaptureCandidatesPanel({ candidates }: CaptureCandidatesPanelProps) {
  return (
    <Card className="space-y-4 border-zinc-800/90 bg-zinc-950/70 p-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Potenciais captações</p>
        <h3 className="mt-1 text-lg font-semibold text-white">Oportunidades do dia</h3>
        <p className="text-xs text-zinc-400">
          Imóveis com sinais de oportunidade, queda de preço e recência.
        </p>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-black/35 p-4 text-sm text-zinc-400">
          Nenhum potencial de captação identificado por enquanto.
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-3">
            {candidates.slice(0, 12).map((candidate) => (
              <div key={candidate.id} className="w-[300px] shrink-0 space-y-2">
                <div className="flex items-center justify-between px-1 text-[11px]">
                  <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-zinc-200">
                    {categoryLabel(candidate.category)}
                  </span>
                  <span className="text-zinc-500">{candidate.reason}</span>
                </div>

                <ListingCard
                  listing={toListing(candidate)}
                  className="border-zinc-800/90 bg-zinc-950/85 shadow-[0_0_0_1px_rgba(39,39,42,0.45)]"
                />

                <button
                  type="button"
                  className="accent-outline accent-sheen accent-focus w-full rounded-md px-2 py-1.5 text-xs text-zinc-200 transition hover:text-white focus-visible:outline-none"
                  onClick={() => {
                    if (candidate.url) {
                      window.open(candidate.url, "_blank", "noopener,noreferrer");
                    }
                  }}
                >
                  Salvar como lead / criar tarefa (em breve)
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

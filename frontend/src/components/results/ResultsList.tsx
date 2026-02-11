import React from 'react';
import { ResultCard } from './ResultCard';
import type { OfferCard } from '../../types';

interface Props {
    results: OfferCard[];
    isLoading: boolean;
    scrapeStatus?: Record<string, string>;
}

export const ResultsList: React.FC<Props> = ({ results, isLoading, scrapeStatus }) => {
    if (isLoading) {
        return (
            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="bg-slate-900/40 border border-slate-800 rounded-3xl h-[400px] animate-pulse"></div>
                ))}
            </div>
        );
    }

    if (results.length === 0) {
        return (
            <div className="mt-12 text-center py-20 bg-slate-900/20 rounded-3xl border border-dashed border-slate-800">
                <p className="text-slate-400 text-xl font-medium">Nenhum imóvel encontrado dentro dos filtros aplicados.</p>
                <p className="text-slate-500 text-sm mt-2">Dica: Tente aumentar o bairro ou o tempo de publicação.</p>
                {scrapeStatus && (
                    <div className="mt-8 flex flex-wrap justify-center gap-2">
                        {Object.entries(scrapeStatus).map(([p, s]) => (
                            <div key={p} className="text-[10px] text-slate-600 bg-slate-800/50 px-2 py-1 rounded-md uppercase font-bold tracking-tighter">
                                {p}: {s === 'ok' ? 'Conectado' : 'Erro'}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="mt-12 space-y-8 pb-20">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-50">
                        {results.length} {results.length === 1 ? 'oferta encontrada' : 'ofertas encontradas'}
                    </h2>
                    <p className="text-slate-500 text-sm">Mostrando resultados reais dos principais portais.</p>
                </div>
                {scrapeStatus && (
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(scrapeStatus).map(([portal, status]) => (
                            <span key={portal} className={`text-[10px] uppercase font-black tracking-widest px-2.5 py-1 rounded-lg border ${status === 'ok' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                                {portal} {(status === 'ok' || status === 'cached') ? '✓' : '✗'}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {results.map((offer, idx) => (
                    <ResultCard key={`${offer.portal}-${offer.external_id}-${idx}`} card={offer} />
                ))}
            </div>
        </div>
    );
};


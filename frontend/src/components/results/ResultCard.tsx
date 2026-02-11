import React from 'react';
import type { OfferCard } from '../../types';

interface Props {
    card: OfferCard;
}

export const ResultCard: React.FC<Props> = ({ card }) => {
    const isImovelweb = (card.portal || '').toLowerCase() === 'imovelweb';

    return (
        <div className="group bg-slate-900/40 border border-slate-800 rounded-3xl overflow-hidden hover:border-primary-500/50 transition-all hover:shadow-2xl hover:shadow-primary-900/10 flex flex-col h-full">
            <div className="aspect-[4/3] overflow-hidden relative">
                <img
                    src={card.main_image_url || 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'}
                    alt={card.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black text-primary-400 uppercase tracking-widest border border-slate-700">
                    {card.portal}
                </div>
                {card.published_days_ago !== undefined && (
                    <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-slate-300 border border-slate-700">
                        {card.published_days_ago === 0 ? 'Publicado hoje' :
                            card.published_days_ago === 1 ? 'Publicado ontem' :
                                `Há ${card.published_days_ago} dias`}
                    </div>
                )}
                <div className="absolute bottom-4 right-4 bg-primary-600 px-4 py-2 rounded-2xl text-lg font-bold text-white shadow-xl">
                    {card.price ? card.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Consultar'}
                </div>
            </div>

            <div className="p-6 flex flex-col flex-1">
                <h3 className="text-lg font-bold mb-2 line-clamp-2 group-hover:text-primary-400 transition-colors h-14 overflow-hidden">
                    {card.title}
                </h3>
                <p className="text-slate-400 text-sm mb-4 line-clamp-1">
                    {card.location.neighborhood}, {card.location.city}
                </p>

                <div className="flex items-center gap-4 text-slate-300 mb-6">
                    {card.specs.area && (
                        <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider">Área</span>
                            <span className="font-semibold">{card.specs.area}m²</span>
                        </div>
                    )}

                    {card.specs.bedrooms !== undefined && (
                        <div className="flex flex-col border-l border-slate-800 pl-4">
                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider">Quartos</span>
                            <span className="font-semibold">{card.specs.bedrooms}</span>
                        </div>
                    )}

                    {card.specs.parking !== undefined && (
                        <div className="flex flex-col border-l border-slate-800 pl-4">
                            {/* ✅ Logo ao lado de "Vagas" SOMENTE no Imovelweb */}
                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider flex items-center gap-2">
                                <span>Vagas</span>
                                {isImovelweb && card.agency_logo_url && (
                                    <img
                                        src={card.agency_logo_url}
                                        alt={card.agency_name ? `Logo ${card.agency_name}` : 'Logo imobiliária'}
                                        className="h-4 w-4 object-contain rounded-sm bg-white p-[1px]"
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                    />
                                )}
                            </span>
                            <span className="font-semibold">{card.specs.parking}</span>
                        </div>
                    )}
                </div>

                {/* ✅ Agency section: NÃO mostrar no Imovelweb */}
                {!isImovelweb && (card.agency_name || card.agency_logo_url) && (
                    <div className="mt-auto mb-4 p-3 bg-slate-800/30 rounded-xl border border-slate-800/50 flex items-center gap-3">
                        {card.agency_logo_url ? (
                            <img src={card.agency_logo_url} alt={card.agency_name} className="w-8 h-8 rounded-lg object-contain bg-white p-0.5" />
                        ) : (
                            <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-[10px] font-bold">Imob</div>
                        )}
                        <div className="flex flex-col min-w-0">
                            <span className="text-[10px] text-slate-500 uppercase font-bold">Imobiliária</span>
                            <span className="text-xs font-semibold text-slate-300 truncate">{card.agency_name || 'Anunciante'}</span>
                        </div>
                    </div>
                )}

                <a
                    href={card.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-3 bg-primary-600/10 hover:bg-primary-600 text-primary-400 hover:text-white rounded-xl font-bold transition-all border border-primary-900/50"
                >
                    Link
                </a>
            </div>
        </div>
    );
};

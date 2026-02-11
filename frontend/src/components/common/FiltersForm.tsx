import React, { useState } from 'react';
import type { SearchFilters } from '../../types';

interface Props {
    onSearch: (filters: SearchFilters) => void;
    isLoading: boolean;
}

export const FiltersForm: React.FC<Props> = ({ onSearch, isLoading }) => {
    const [filters, setFilters] = useState<SearchFilters>({
        city: 'Campinas',
        state: 'SP',
        operation: 'sale',
        property_type: 'apartment',
        recency_days: 7,
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!filters.query || filters.query.length < 2) newErrors.query = 'Neighborhood is required';
        if (!filters.price_min) newErrors.price_min = 'Min price is required';
        if (!filters.price_max) newErrors.price_max = 'Max price is required';
        if (!filters.bedrooms_min && filters.bedrooms_min !== 0) newErrors.bedrooms_min = 'Min bedrooms is required';

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            onSearch(filters);
        }
    };

    return (
        <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800 shadow-2xl max-w-5xl mx-auto -mt-10 relative z-20 backdrop-blur-xl">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <span className="w-1.5 h-6 bg-primary-500 rounded-full"></span>
                Filters
            </h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 flex justify-between">
                        Neighborhood <span className="text-primary-500">*</span>
                    </label>
                    <input
                        type="text"
                        placeholder="e.g. Cambuí"
                        className={`w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 transition-all ${errors.query ? 'ring-2 ring-red-500/50 border-red-500/50' : ''}`}
                        value={filters.query || ''}
                        onChange={(e) => {
                            setFilters({ ...filters, query: e.target.value });
                            if (errors.query) setErrors({ ...errors, query: '' });
                        }}
                    />
                    {errors.query && <p className="text-xs text-red-400 mt-1">{errors.query}</p>}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400">
                        Property Type <span className="text-primary-500">*</span>
                    </label>
                    <select
                        className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                        value={filters.property_type}
                        onChange={(e) => setFilters({ ...filters, property_type: e.target.value as any })}
                    >
                        <option value="apartment">Apartment</option>
                        <option value="house">House</option>
                        <option value="land">Land</option>
                        <option value="all">All</option>
                    </select>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400">Operation</label>
                    <div className="flex bg-slate-800 p-1 rounded-xl">
                        <button
                            type="button"
                            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${filters.operation === 'sale' ? 'bg-primary-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                            onClick={() => setFilters({ ...filters, operation: 'sale' })}
                        >
                            Sale
                        </button>
                        <button
                            type="button"
                            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${filters.operation === 'rent' ? 'bg-primary-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                            onClick={() => setFilters({ ...filters, operation: 'rent' })}
                        >
                            Rent
                        </button>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400">Recency</label>
                    <select
                        className="w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                        value={filters.recency_days}
                        onChange={(e) => setFilters({ ...filters, recency_days: parseInt(e.target.value) })}
                    >
                        <option value={7}>Last 7 days</option>
                        <option value={15}>Last 15 days</option>
                    </select>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 flex justify-between">
                        Min Price (BRL) <span className="text-primary-500">*</span>
                    </label>
                    <input
                        type="number"
                        placeholder="e.g. 500000"
                        className={`w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 transition-all ${errors.price_min ? 'ring-2 ring-red-500/50 border-red-500/50' : ''}`}
                        value={filters.price_min || ''}
                        onChange={(e) => {
                            setFilters({ ...filters, price_min: parseInt(e.target.value) || undefined });
                            if (errors.price_min) setErrors({ ...errors, price_min: '' });
                        }}
                    />
                    {errors.price_min && <p className="text-xs text-red-400 mt-1">{errors.price_min}</p>}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 flex justify-between">
                        Max Price (BRL) <span className="text-primary-500">*</span>
                    </label>
                    <input
                        type="number"
                        placeholder="e.g. 1500000"
                        className={`w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 transition-all ${errors.price_max ? 'ring-2 ring-red-500/50 border-red-500/50' : ''}`}
                        value={filters.price_max || ''}
                        onChange={(e) => {
                            setFilters({ ...filters, price_max: parseInt(e.target.value) || undefined });
                            if (errors.price_max) setErrors({ ...errors, price_max: '' });
                        }}
                    />
                    {errors.price_max && <p className="text-xs text-red-400 mt-1">{errors.price_max}</p>}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 flex justify-between">
                        Min Bedrooms <span className="text-primary-500">*</span>
                    </label>
                    <input
                        type="number"
                        placeholder="e.g. 2"
                        className={`w-full bg-slate-800 border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 transition-all ${errors.bedrooms_min ? 'ring-2 ring-red-500/50 border-red-500/50' : ''}`}
                        value={filters.bedrooms_min || ''}
                        onChange={(e) => {
                            setFilters({ ...filters, bedrooms_min: parseInt(e.target.value) || undefined });
                            if (errors.bedrooms_min) setErrors({ ...errors, bedrooms_min: '' });
                        }}
                    />
                    {errors.bedrooms_min && <p className="text-xs text-red-400 mt-1">{errors.bedrooms_min}</p>}
                </div>


                <div className="lg:col-span-1 flex items-end">
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-primary-600 hover:bg-primary-500 text-white py-2.5 rounded-xl font-bold transition-all shadow-xl shadow-primary-900/40 disabled:opacity-50 flex items-center justify-center gap-3"
                    >
                        {isLoading ? (
                            <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                        ) : null}
                        Search
                    </button>
                </div>
            </form>
        </div>
    );
};

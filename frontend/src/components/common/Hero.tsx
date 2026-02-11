import React from 'react';

export const Hero: React.FC = () => {
    return (
        <div className="relative pt-32 pb-20 overflow-hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
                <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
                    Find your <span className="text-primary-500">ideal home</span>
                </h1>
                <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
                    Search apartments, houses, and studios in Campinas. Offers from all portals in one place.
                </p>
            </div>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-0">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-primary-900/20 blur-[120px] rounded-full opacity-50"></div>
            </div>
        </div>
    );
};

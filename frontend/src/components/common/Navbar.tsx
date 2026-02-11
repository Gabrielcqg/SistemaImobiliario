import React from 'react';

export const Navbar: React.FC = () => {
    return (
        <nav className="fixed top-0 w-full z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <div className="flex items-center">
                        <span className="text-2xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                            ImoFinder
                        </span>
                    </div>
                    <div className="hidden md:flex items-center space-x-8">
                        <a href="#" className="text-slate-300 hover:text-white font-medium transition-colors">Home</a>
                        <a href="#" className="text-slate-300 hover:text-white font-medium transition-colors">How it works</a>
                        <a href="#" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</a>
                        <a href="#" className="text-slate-300 hover:text-white font-medium transition-colors">Contact</a>
                        <button className="bg-primary-600 hover:bg-primary-500 text-white px-5 py-2 rounded-full font-semibold transition-all shadow-lg shadow-primary-900/20">
                            Sign In
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
};

import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    isLoading?: boolean;
}

export function Pagination({ currentPage, totalPages, onPageChange, isLoading }: PaginationProps) {
    if (totalPages <= 1) return null;

    const pages = [];
    const maxVisible = 5;

    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
        pages.push(i);
    }

    return (
        <div className="flex items-center justify-center gap-2 py-8 mt-4">
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1 || isLoading}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 disabled:opacity-50 transition-all"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>

            {start > 1 && (
                <>
                    <button
                        onClick={() => onPageChange(1)}
                        className={`w-10 h-10 rounded-lg border transition-all ${currentPage === 1 ? 'bg-primary-500 border-primary-400 font-bold' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'
                            }`}
                        disabled={isLoading}
                    >
                        1
                    </button>
                    {start > 2 && <span className="text-slate-500">...</span>}
                </>
            )}

            {pages.map(p => (
                <button
                    key={p}
                    onClick={() => onPageChange(p)}
                    className={`w-10 h-10 rounded-lg border transition-all ${currentPage === p ? 'bg-primary-500 border-primary-400 font-bold' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'
                        }`}
                    disabled={isLoading}
                >
                    {p}
                </button>
            ))}

            {end < totalPages && (
                <>
                    {end < totalPages - 1 && <span className="text-slate-500">...</span>}
                    <button
                        onClick={() => onPageChange(totalPages)}
                        className={`w-10 h-10 rounded-lg border transition-all ${currentPage === totalPages ? 'bg-primary-500 border-primary-400 font-bold' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'
                            }`}
                        disabled={isLoading}
                    >
                        {totalPages}
                    </button>
                </>
            )}

            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages || isLoading}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 disabled:opacity-50 transition-all"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
        </div>
    );
}

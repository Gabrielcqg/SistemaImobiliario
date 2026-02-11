import { useState } from 'react';
import { Navbar } from './components/common/Navbar';
import { Hero } from './components/common/Hero';
import { FiltersForm } from './components/common/FiltersForm';
import { ResultsList } from './components/results/ResultsList';
import { Pagination } from './components/results/Pagination';
import type { OfferCard, SearchFilters } from './types';
import { searchStream } from './services/api';

function App() {
  const [results, setResults] = useState<OfferCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<Record<string, string>>();
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{ total: number, page: number, page_size: number, has_next: boolean, total_pages: number }>();
  const [activeFilters, setActiveFilters] = useState<SearchFilters | null>(null);

  const handleSearch = async (filters: SearchFilters, page = 1) => {
    setIsLoading(true);
    setError(null);
    setScrapeStatus({});

    if (page === 1) {
      setResults([]);
      setActiveFilters(filters);
    } else {
      // Keep results if going to next page, but will be replaced/appended 
      // Actually pagination usually replaces.
      setResults([]);
    }

    const searchParams = { ...filters, page, page_size: 24 };

    searchStream(searchParams, {
      onRunId: (id) => console.log('Run started:', id),
      onCard: (card) => {
        setResults(prev => {
          // Check for duplicates
          if (prev.some(c => c.url === card.url)) return prev;

          const newResults = [...prev, card];
          // Simple sort by recency
          return newResults.sort((a, b) =>
            (a.published_days_ago ?? 999) - (b.published_days_ago ?? 999)
          );
        });
      },
      onResults: (resp) => {
        // This is for cached results or initial state
        setResults(resp.results);
        setPagination(resp.pagination);
        setScrapeStatus(resp.metadata.scrape_status);
        setIsLoading(false);
      },
      onFinal: (metadata) => {
        setScrapeStatus(metadata.scrape_status);
        setPagination(prev => ({
          ...prev!,
          total_pages: metadata.total_pages || prev?.total_pages || 1,
          page: page,
          has_next: page < (metadata.total_pages || 1)
        }));
        setIsLoading(false);
      },
      onError: (err) => {
        setError(err);
        setIsLoading(false);
      }
    });
  };


  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-primary-500/30">
      <Navbar />
      <main>
        <Hero />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FiltersForm onSearch={(f) => handleSearch(f, 1)} isLoading={isLoading} />

          {error && (
            <div className="mt-8 p-4 bg-red-500/10 border border-red-500/50 rounded-2xl text-red-400 text-center">
              {error}
            </div>
          )}

          <ResultsList results={results} isLoading={isLoading && results.length === 0} scrapeStatus={scrapeStatus} />

          {pagination && (
            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.total_pages}
              onPageChange={(p) => handleSearch(activeFilters || ({} as SearchFilters), p)}
              isLoading={isLoading}
            />
          )}

        </div>
      </main>


      <footer className="border-t border-slate-900 py-10 text-center text-slate-600 text-sm">
        <p>© 2026 ImoFinder. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;

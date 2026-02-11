import type { SearchFilters, SearchResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export const searchOffers = async (filters: SearchFilters): Promise<SearchResponse> => {
    const queryParams = new URLSearchParams();
    if (filters.query) queryParams.append('query', filters.query);
    queryParams.append('city', filters.city);
    queryParams.append('state', filters.state);
    queryParams.append('operation', filters.operation);
    queryParams.append('property_type', filters.property_type);
    queryParams.append('recency_days', filters.recency_days.toString());
    if (filters.price_min) queryParams.append('price_min', filters.price_min.toString());
    if (filters.price_max) queryParams.append('price_max', filters.price_max.toString());
    if (filters.bedrooms_min !== undefined) queryParams.append('bedrooms_min', filters.bedrooms_min.toString());
    if (filters.page) queryParams.append('page', filters.page.toString());
    if (filters.page_size) queryParams.append('page_size', filters.page_size.toString());

    const response = await fetch(`${API_BASE_URL}/search/offers?${queryParams.toString()}`);

    if (!response.ok) {
        throw new Error('Failed to fetch offers');
    }
    return response.json();
};

export const searchStream = (
    filters: SearchFilters,
    callbacks: {
        onRunId?: (runId: string) => void;
        onCard?: (card: any) => void;
        onResults?: (resp: SearchResponse) => void;
        onFinal?: (metadata: any) => void;
        onError?: (err: string) => void;
    }
) => {
    const WS_URL = API_BASE_URL.replace('http', 'ws') + '/search/ws';
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        socket.send(JSON.stringify({ filters, page: filters.page || 1, page_size: filters.page_size || 20 }));
    };

    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
            case 'run_id':
                callbacks.onRunId?.(msg.data);
                break;
            case 'card':
                callbacks.onCard?.(msg.data);
                break;
            case 'results':
                callbacks.onResults?.(msg.data);
                break;
            case 'results_final':
                callbacks.onFinal?.(msg.metadata);
                socket.close();
                break;
            case 'error':
                callbacks.onError?.(msg.message);
                socket.close();
                break;
        }
    };

    socket.onerror = (err) => {
        callbacks.onError?.('WebSocket error');
    };

    return () => socket.close();
};

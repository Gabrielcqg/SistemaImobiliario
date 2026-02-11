export interface Specs {
    area?: number;
    bedrooms?: number;
    bathrooms?: number;
    parking?: number;
}

export interface Location {
    neighborhood?: string;
    city: string;
    state: string;
}

export interface OfferCard {
    id?: string;
    portal: 'imovelweb' | 'zap' | 'vivareal';
    external_id: string;
    title: string;
    url: string;
    main_image_url?: string;
    agency_name?: string;
    agency_logo_url?: string;
    price?: number;
    currency: string;
    specs: Specs;
    location: Location;
    published_days_ago?: number;
    last_seen: string;
}

export interface SearchResponse {
    results: OfferCard[];
    metadata: {
        count: number;
        cached: boolean;
        scrape_status: Record<string, string>;
    };
    pagination?: {
        total: number;
        page: number;
        page_size: number;
        has_next: boolean;
        total_pages: number;
    };
}


export interface SearchFilters {
    query?: string;
    city: string;
    state: string;
    operation: 'sale' | 'rent';
    property_type: 'apartment' | 'house' | 'land' | 'all';
    recency_days: number;
    price_min?: number;
    price_max?: number;
    bedrooms_min?: number;
    bathrooms_min?: number;
    area_min?: number;
    area_max?: number;
    page?: number;
    page_size?: number;
}

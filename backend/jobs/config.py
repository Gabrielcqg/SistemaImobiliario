"""
Configuration for the scraping pipeline.
"""
from typing import List

# TTL for considering a listing as inactive (in days)
LISTING_TTL_DAYS = 14

# Maximum pages to scrape per portal
MAX_PAGES_PER_PORTAL = 10

# Portals to scan
ACTIVE_PORTALS: List[str] = ["imovelweb", "zap", "vivareal"]

# Default city/state for Campinas scan
DEFAULT_CITY = "campinas"
DEFAULT_STATE = "sp"

# Thresholds for "below market" calculation
BELOW_MARKET_THRESHOLD_PCT = 0.15  # 15% below median

# Opportunity score weights
SCORE_NEW_24H = 30
SCORE_NEW_72H = 20
SCORE_NEW_7D = 10
SCORE_BELOW_MARKET_BADGE = 40
SCORE_BELOW_MARKET_MAX = 40
SCORE_PRICE_DROP_MAX = 20
SCORE_HIGH_QUALITY = 10

# Delay between requests (to avoid rate limiting)
REQUEST_DELAY_SECONDS = 1.5

# Badge keywords to look for
BADGE_KEYWORDS = {
    "preco_abaixo_do_mercado": [
        "preço abaixo do mercado",
        "below market",
        "preco abaixo",
        "abaixo do mercado"
    ],
    "destaque": ["destaque", "featured", "highlight"],
    "novo": ["novo", "new", "recém"],
    "mobiliado": ["mobiliado", "furnished"],
    "tour_virtual": ["tour virtual", "virtual tour", "tour 3d"],
    "oportunidade": ["oportunidade", "opportunity", "imperdível"],
}

# Neighborhood normalization map
NEIGHBORHOOD_NORMALIZE_MAP = {
    "cambui": "cambuí",
    "taquaral": "taquaral",
    "barao geraldo": "barão geraldo",
    "barão geraldo": "barão geraldo",
    "nova campinas": "nova campinas",
    "mansoes santo antonio": "mansões santo antônio",
    "mansões santo antônio": "mansões santo antônio",
    "jardim chapadao": "jardim chapadão",
    "jardim chapadão": "jardim chapadão",
    "centro": "centro",
    "guanabara": "guanabara",
    "alphaville": "alphaville campinas",
    "swiss park": "swiss park",
    "parque prado": "parque prado",
    "vila industrial": "vila industrial",
    "botafogo": "botafogo",
    "jardim pauliceia": "jardim paulicéia",
    "jardim paulicéia": "jardim paulicéia",
}

# Property type normalization map
PROPERTY_TYPE_MAP = {
    "apartamento": "apartment",
    "apto": "apartment",
    "flat": "apartment",
    "studio": "apartment",
    "kitnet": "apartment",
    "loft": "apartment",
    "cobertura": "apartment",
    "casa": "house",
    "sobrado": "house",
    "casa de condomínio": "house",
    "casa de condominio": "house",
    "terreno": "land",
    "lote": "land",
    "área": "land",
    "area": "land",
    "sala comercial": "commercial",
    "loja": "commercial",
    "galpão": "commercial",
    "galpao": "commercial",
    "prédio": "commercial",
    "predio": "commercial",
}

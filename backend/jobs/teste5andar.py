import os
import json
import re
import time
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import requests

# --- CARREGAMENTO DO .ENV ---
try:
    from dotenv import load_dotenv
    
    # Procura o .env na pasta 'pai' (raiz) ou na pasta atual
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        env_path = Path(__file__).resolve().parent / ".env"
        
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

# --- IMPORT DO SUPABASE ---
try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = None

# =========================================================
# 1. CONFIGURAÇÕES PRINCIPAIS DO SCRAPER
# =========================================================
TZ_SP = ZoneInfo("America/Sao_Paulo")
PORTAL = "quintoandar"
DEAL_TYPE = os.getenv("QA_DEAL_TYPE", "venda").strip().lower() or "venda"
CITY_SLUG = "campinas-sp-brasil"

PAGE_SIZE = 12
PAGES = 5  
SLEEP_SECONDS = 180
RUN_ONCE = True

# O "Muro": Quantos imóveis repetidos (que já estão no DB) 
# ele precisa ver em sequência para parar a paginação?
MAX_CONHECIDOS_CONSECUTIVOS = 5 

# =========================================================
# 2. CREDENCIAIS DO SUPABASE
# =========================================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "") 
SUPABASE_WRITE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

supabase_write = None
if SUPABASE_URL and SUPABASE_WRITE_KEY and create_client:
    try:
        supabase_write = create_client(SUPABASE_URL, SUPABASE_WRITE_KEY)
    except Exception as e:
        print(f"Erro ao conectar no Supabase: {e}")

# =========================================================
# 3. DADOS DA API
# =========================================================
QA_SEARCH_URL = "https://apigw.prod.quintoandar.com.br/house-listing-search/v2/search/list"
QA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    "Content-Type": "application/json",
    "Origin": "https://www.quintoandar.com.br"
}

# ---------------- Utils ----------------
def now_sp() -> datetime:
    return datetime.now(TZ_SP)

def now_iso_sp() -> str:
    return now_sp().isoformat()

def ts() -> str:
    return now_sp().strftime("%H:%M:%S")

def normalize_property_type(raw: str) -> str:
    t = str(raw or "").lower()
    if any(k in t for k in ["apartment", "apartamento", "apto"]): return "apartment"
    if any(k in t for k in ["house", "home", "casa", "sobrado"]): return "house"
    if any(k in t for k in ["land", "terreno", "lote"]): return "land"
    if any(k in t for k in ["commercial", "comercial", "office", "loja", "sala"]): return "commercial"
    return "other"

# ---------------- API fetch ----------------
def build_payload(page_index: int) -> dict:
    offset = page_index * PAGE_SIZE
    return {
        "context": {"mapShowing": True, "listShowing": True, "isSSR": False},
        "filters": {
            "businessContext": "SALE" if DEAL_TYPE == "venda" else "RENT",
            "location": {
                "coordinate": {"lat": -22.932925, "lng": -47.073845},
                "viewport": {
                    "east": -46.98114785644531, "north": -22.888335285773444,
                    "south": -22.977500037118176, "west": -47.166542143554686
                },
                "neighborhoods": [], "countryCode": "BR"
            },
            "availability": "ANY", "occupancy": "ANY"
        },
        "sorting": {"criteria": "MOST_RECENT", "order": "DESC"},
        "pagination": {"pageSize": PAGE_SIZE, "offset": offset},
        "slug": CITY_SLUG,
        "fields": [
            "id", "coverImage", "rent", "totalCost", "salePrice", 
            "iptuPlusCondominium", "area", "address", "regionName", "city", 
            "type", "bedrooms", "parkingSpaces", "bathrooms", "shortSaleDescription"
        ]
    }

def get_known_ids_from_db(ids_to_check: list) -> set:
    """Verifica no Supabase quais dos IDs da página já existem no nosso banco."""
    if not supabase_write or not ids_to_check:
        return set()
    
    try:
        resp = supabase_write.table("listings").select("external_id").eq("portal", PORTAL).in_("external_id", ids_to_check).execute()
        return {str(item["external_id"]) for item in (resp.data or [])}
    except Exception as e:
        print(f"[{ts()}] ⚠️ Falha ao checar IDs no banco: {e}")
        return set()

def hit_to_row(hit: dict, is_new: bool) -> dict | None:
    src = (hit or {}).get("_source") or {}
    listing_id = str(src.get("id") or hit.get("_id") or "").strip()
    if not listing_id: return None

    now_iso = now_iso_sp()
    price = src.get("salePrice") if src.get("salePrice") is not None else src.get("rent")
    try: price = float(price or 0)
    except Exception: price = 0.0

    row = {
        "portal": PORTAL,
        "deal_type": DEAL_TYPE,
        "external_id": listing_id,
        "dedupe_key": f"{PORTAL}:{listing_id}",
        "url": f"https://www.quintoandar.com.br/imovel/{listing_id}",
        "main_image_url": f"https://quintoandar.com.br/img/{src.get('coverImage')}" if src.get("coverImage") else "",
        "title": src.get("shortSaleDescription") or f"Imóvel {listing_id}",
        "property_type": normalize_property_type(src.get("type") or ""),
        "price": price,
        "city": (src.get("city") or "Campinas"),
        "state": "SP",
        "neighborhood": (src.get("neighbourhood") or src.get("regionName") or ""),
        "street": (src.get("address") or ""),
        "area_m2": float(src.get("area") or 0),
        "bedrooms": int(src.get("bedrooms") or 0),
        "bathrooms": int(src.get("bathrooms") or 0),
        "parking": int(src.get("parkingSpaces") or 0),
        "condo_fee": float(src.get("condoFee") or src.get("iptuPlusCondominium") or 0) - float(src.get("iptu") or 0),
        "iptu": float(src.get("iptu") or 0),
        "last_seen_at": now_iso,
        "first_seen_at": now_iso, 
    }

    # Só injeta o published_at se o imóvel for NOVO.
    # Se já existe no banco, não enviamos essa chave. Assim, o Upsert atualiza o preço,
    # mas NUNCA sobrescreve a data de publicação original que já está no banco.
    if is_new:
        row["published_at"] = now_iso

    return row

# ---------------- Main cycle ----------------
def executar_ciclo_quintoandar():
    inicio = time.time()
    print(f"[{ts()}] [QA] Iniciando varredura | Estratégia: Overlap de Banco de Dados", flush=True)

    rows_to_upsert = []
    conhecidos_consecutivos = 0
    bater_na_parede = False

    for p in range(PAGES):
        if bater_na_parede:
            break
            
        payload = build_payload(p)
        try:
            r = requests.post(QA_SEARCH_URL, headers=QA_HEADERS, json=payload, timeout=25)
        except Exception as e:
            print(f"[{ts()}] ❌ Erro de requisição na página {p+1}: {e}")
            break

        if r.status_code != 200:
            print(f"[{ts()}] ❌ Erro da API na página {p+1}: status={r.status_code}")
            break

        hits = (r.json().get("hits") or {}).get("hits") or []
        if not hits:
            break

        # Extrai os IDs dessa página para checar no banco de uma vez só
        page_ids = [str(h.get("_source", {}).get("id")) for h in hits if h.get("_source", {}).get("id")]
        known_ids_in_db = get_known_ids_from_db(page_ids)

        novos_na_pagina = 0

        for h in hits:
            listing_id = str(h.get("_source", {}).get("id"))
            
            # LÓGICA DE BARREIRA (OVERLAP)
            if listing_id in known_ids_in_db:
                conhecidos_consecutivos += 1
                is_new = False
            else:
                conhecidos_consecutivos = 0 # Achou um novo, zera o contador!
                novos_na_pagina += 1
                is_new = True

            if conhecidos_consecutivos >= MAX_CONHECIDOS_CONSECUTIVOS:
                print(f"[{ts()}] 🛑 PAREDE ATINGIDA! {MAX_CONHECIDOS_CONSECUTIVOS} imóveis repetidos seguidos encontrados (ID: {listing_id}).")
                bater_na_parede = True
                break
            
            row = hit_to_row(h, is_new=is_new)
            if row:
                rows_to_upsert.append(row)

        print(f"[{ts()}] [QA] Pagina {p+1} processada. Novos encontrados: {novos_na_pagina}", flush=True)
        time.sleep(1)

    print(f"[{ts()}] [QA] Total de imóveis preparados para o banco: {len(rows_to_upsert)}")

    if supabase_write is None:
        print(f"[{ts()}] [QA] Rodando sem Supabase conectado. Modo simulação concluído.")
        return

    # Envia pro banco (Upsert)
    if rows_to_upsert:
        try:
            supabase_write.table("listings").upsert(rows_to_upsert, on_conflict="portal,external_id", ignore_duplicates=False).execute()
            print(f"[{ts()}] [QA] 🚀 {len(rows_to_upsert)} registros gravados/atualizados no Supabase com sucesso.")
        except Exception as e:
            print(f"[{ts()}] ❌ Erro ao gravar no Supabase: {e}")

    duration_ms = int((time.time() - inicio) * 1000)
    print(f"[{ts()}] [QA] Ciclo finalizado em {duration_ms}ms.\n", flush=True)


if __name__ == "__main__":
    while True:
        executar_ciclo_quintoandar()
        if RUN_ONCE:
            break
        print(f"[{ts()}] Aguardando {SLEEP_SECONDS} segundos para a próxima varredura...")
        time.sleep(SLEEP_SECONDS)
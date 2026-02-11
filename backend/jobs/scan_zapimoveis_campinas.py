import asyncio
import sys
import os
import re
import argparse
import hashlib
import logging
import json
import random
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup

# -----------------------------
# 1. Configuração e Env
# -----------------------------
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.scrapers.stealth import StealthFetcher
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / '.env'
if not env_path.exists(): 
    env_path = Path(__file__).resolve().parent / '.env'

load_dotenv(dotenv_path=env_path)

try:
    from supabase import create_client
except ImportError:
    create_client = None

logger = logging.getLogger("scan_zap")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

# URL Fixa
FIXED_URL = "https://www.zapimoveis.com.br/venda/imoveis/sp+campinas/?transacao=venda&onde=%2CS%C3%A3o+Paulo%2CCampinas%2C%2C%2C%2C%2Ccity%2CBR%3ESao+Paulo%3ENULL%3ECampinas%2C-22.905082%2C-47.061333%2C&ordem=MOST_RECENT"

# -----------------------------
# 2. Utils e Parsers
# -----------------------------

def with_page(url: str, page: int) -> str:
    if "pagina=" in url:
        return re.sub(r"pagina=\d+", f"pagina={page}", url)
    else:
        return f"{url}&pagina={page}"

def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())

def parse_money_brl_to_int(text: str) -> Optional[int]:
    if not text: return None
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None

def extract_external_id(url: str) -> str:
    if not url: return ""
    m = re.search(r"id-(\d+)", url)
    if m: return m.group(1)
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]

def parse_smart_float(text: str) -> Optional[float]:
    if not text: return None
    clean_text = text.replace(".", "").replace(",", ".")
    match = re.search(r"(\d+(\.\d+)?)", clean_text)
    return float(match.group(1)) if match else None

# --- PARSER HÍBRIDO (JSON-LD + HTML) ---

def parse_cards_from_listing_html(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html or "", "html.parser")
    
    # Check básico de bloqueio
    txt = soup.get_text().lower()
    if "verifique se você é humano" in txt or "access denied" in txt:
        logger.warning("⛔ BLOCK: Captcha detectado.")
        return []

    processed_cards = []
    
    # 1. Tentar Extração via JSON-LD (Dados Estruturados do Google)
    # Pega dados "brutos" que o site entrega para o Google (Preço e ID confiáveis)
    json_ld_scripts = soup.find_all('script', type='application/ld+json')
    structured_items = {}
    
    for script in json_ld_scripts:
        try:
            data = json.loads(script.string)
            if data.get('@type') == 'ItemList' and 'itemListElement' in data:
                for item in data['itemListElement']:
                    real_item = item.get('item', {})
                    url = real_item.get('url', '')
                    ext_id = extract_external_id(url)
                    if ext_id:
                        structured_items[ext_id] = real_item
        except:
            continue

    # 2. Extração Visual (HTML)
    # Percorre os cards visuais para pegar dados que não estão no JSON (Ex: IPTU, Tag Abaixo do Preço)
    html_cards = soup.select('li[data-cy="rp-property-cd"], [data-testid="result-card"]')
    
    for container in html_cards:
        # Link e ID
        link_elem = container.select_one("a[href]")
        url = link_elem.get("href", "") if link_elem else ""
        if url and not url.startswith("http"): 
            url = "https://www.zapimoveis.com.br" + url
        
        ext_id = extract_external_id(url)
        # Tenta casar com os dados do JSON se existirem
        json_data = structured_items.get(ext_id, {})
        
        # --- Preços e Taxas ---
        price = None
        condo_fee = None
        iptu = None
        
        # Tenta pegar do container visual de preço (geralmente tem as taxas)
        price_container = container.select_one('[data-cy="rp-cardProperty-price-txt"]')
        if price_container:
            # Preço principal
            price_text = price_container.select_one("p:nth-of-type(1)")
            if price_text:
                price = parse_money_brl_to_int(price_text.get_text())
            
            # Taxas (Condominio e IPTU)
            fees_text = price_container.select_one("p:nth-of-type(2)")
            if fees_text:
                ft = fees_text.get_text()
                if "Cond" in ft:
                    m = re.search(r"Cond.*?R\$\s*([\d\.,]+)", ft)
                    if m: condo_fee = parse_money_brl_to_int(m.group(1))
                if "IPTU" in ft:
                    m = re.search(r"IPTU.*?R\$\s*([\d\.,]+)", ft)
                    if m: iptu = parse_money_brl_to_int(m.group(1))
        
        # Se não achou preço no HTML, usa do JSON (Fallback)
        if not price and json_data:
            offers = json_data.get('offers', {})
            price = int(offers.get('price', 0)) if offers.get('price') else None

        # --- Localização ---
        title = None
        neighborhood = None
        city = "Campinas"
        
        loc_node = container.select_one('[data-cy="rp-cardProperty-location-txt"]')
        address_node = container.select_one('[data-cy="rp-cardProperty-street-txt"]')
        
        if loc_node:
            # Ex: "Apartamento à venda em Jardim São Vicente, Campinas"
            full_loc = normalize_spaces(loc_node.get_text())
            if " em " in full_loc:
                parts = full_loc.split(" em ")[-1].split(",")
                if len(parts) > 0: neighborhood = parts[0].strip()
                if len(parts) > 1: city = parts[1].strip()
            else:
                neighborhood = full_loc
        
        street = address_node.get_text(strip=True) if address_node else ""

        # --- Specs (Area, Quartos, etc) ---
        def get_spec(attr_name, json_key):
            # Prioridade HTML (data-cy)
            node = container.select_one(f'[data-cy="rp-cardProperty-{attr_name}-txt"]')
            if node:
                val = parse_smart_float(node.get_text())
                if val is not None: return val
            # Fallback JSON
            if json_data:
                if json_key == 'floorSize':
                    fs = json_data.get('floorSize', {})
                    return float(fs.get('value', 0)) if fs else 0
                return json_data.get(json_key, 0)
            return 0

        area = get_spec('propertyArea', 'floorSize')
        bedrooms = int(get_spec('bedroomQuantity', 'numberOfBedrooms'))
        bathrooms = int(get_spec('bathroomQuantity', 'numberOfBathroomsTotal'))
        parking = int(get_spec('parkingSpacesQuantity', 'numberOfParkingSpaces'))

        # --- Imagem ---
        img_url = None
        # Tenta pegar do carrossel HTML
        img_node = container.select_one('img[src^="http"]')
        if img_node:
            img_url = img_node.get('src')
        elif json_data and json_data.get('image'):
            # Fallback JSON
            imgs = json_data.get('image')
            if isinstance(imgs, list) and len(imgs) > 0:
                img_url = imgs[0]

        # --- Check de "Abaixo do preço" (SEU PEDIDO) ---
        is_below_market = False
        # Procura a div exata que você forneceu
        below_node = container.select_one('[data-testid="rp-card-belowPrice-txt"]')
        if below_node:
            is_below_market = True

        processed_cards.append({
            "portal": "zap",
            "url": url,
            "external_id": ext_id,
            "title": normalize_spaces(loc_node.get_text()) if loc_node else "",
            "price": price,
            "location_data": {
                "city": city,
                "neighborhood": neighborhood,
                "address": street,
                "raw": f"{neighborhood}, {city}"
            },
            "specs": {
                "area_m2": area,
                "bedrooms": bedrooms,
                "bathrooms": bathrooms,
                "parking": parking,
                "condo_fee": condo_fee,
                "iptu": iptu
            },
            "main_image_url": img_url,
            "is_below_market": is_below_market,
            "raw_card_text": normalize_spaces(container.get_text(" "))
        })

    return processed_cards

# -----------------------------
# 3. Supabase
# -----------------------------

def get_supabase_client():
    if create_client is None: return None
    sb_url = os.getenv("SUPABASE_URL")
    sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not sb_url or not sb_key: return None
    return create_client(sb_url, sb_key)

def to_listing_row(card: Dict[str, Any]) -> Dict[str, Any]:
    loc = card["location_data"]
    specs = card["specs"]
    return {
        "portal": card["portal"],
        "external_id": card["external_id"],
        "url": card["url"],
        "title": card.get("title"),
        "price": card.get("price"),
        "neighborhood": loc["neighborhood"],
        "city": loc["city"],
        "state": "SP",
        "area_m2": specs.get("area_m2"),
        "bedrooms": specs.get("bedrooms"),
        "bathrooms": specs.get("bathrooms"),
        "parking": specs.get("parking"),
        "condo_fee": specs.get("condo_fee"),
        "iptu": specs.get("iptu"),
        "is_below_market": card.get("is_below_market"),
        "main_image_url": card.get("main_image_url"),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        "full_data": {"raw_card_text": card.get("raw_card_text")},
    }

# -----------------------------
# 4. Job Principal
# -----------------------------

async def run_scan(pages: int, max_cards_per_page: int, headless: bool, dry_run: bool) -> None:
    sb = None if dry_run else get_supabase_client()
    
    if not dry_run and not sb:
        logger.error("Abortando: Falha ao conectar no Supabase.")
        return

    dump_dir = Path("html_dumps_zap")
    dump_dir.mkdir(exist_ok=True)
    total_written = 0

    for page in range(1, pages + 1):
        fetcher = None
        try:
            logger.info(f"🔄 [INIT] Abrindo navegador para pág {page}...")
            fetcher = StealthFetcher(headless=headless) 
            # Tempo de espera para scripts
            await asyncio.sleep(4) 

            page_url = with_page(FIXED_URL, page)
            logger.info(f"🌍 [FETCH] {page_url}")
            
            html = await fetcher.fetch(page_url)
            
            if not html or len(html) < 1000:
                logger.warning(f"⛔ [BLOCK] Página vazia ou bloqueada.")
                continue

            # Opcional: Salvar HTML para debug
            # timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            # with open(dump_dir / f"zap_page_{page}_{timestamp}.html", "w", encoding="utf-8") as f: f.write(html)

            cards = parse_cards_from_listing_html(html)
            
            if not cards:
                logger.warning(f"⚠️ [VAZIO] 0 cards encontrados. Verifique seletores.")
                continue

            # Remove duplicatas de ID na mesma página
            unique_cards = []
            seen_ids = set()
            for c in cards:
                eid = c.get('external_id')
                if eid and eid not in seen_ids:
                    seen_ids.add(eid)
                    unique_cards.append(c)
            
            final_cards = unique_cards[:max_cards_per_page] if max_cards_per_page > 0 else unique_cards
            
            logger.info(f"✅ [SUCESSO] {len(final_cards)} imóveis encontrados na pág {page}")

            # Log bonito no terminal
            for i, c in enumerate(final_cards, 1):
                loc = c['location_data']
                specs = c['specs']
                p_fmt = f"{c['price']:,}".replace(",", ".") if c['price'] else "N/A"
                
                fire_icon = "🔥" if c['is_below_market'] else ""
                
                logger.info(f"🏠 #{i} {fire_icon} {c['title'][:40]}... | R$ {p_fmt} | {specs['area_m2']}m²")
                if c['is_below_market']:
                    logger.info(f"   └── 💰 OPORTUNIDADE DETECTADA!")

            rows = [to_listing_row(c) for c in final_cards]
            
            if not dry_run and sb and rows:
                try:
                    await asyncio.to_thread(sb.table("listings").upsert(rows, on_conflict="portal,external_id").execute)
                    total_written += len(rows)
                    logger.info(f"💾 [DB] Lote salvo no Supabase.")
                except Exception as db_err:
                    logger.error(f"Erro Supabase: {db_err}")

            if page < pages:
                wait = random.uniform(8.0, 15.0)
                await asyncio.sleep(wait)

        except Exception as e:
            logger.error(f"❌ Erro pág {page}: {e}")
        
        finally:
            if fetcher:
                await fetcher.close()

    logger.info(f"🏁 [FIM] Total processado: {total_written}")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pages", type=int, default=1)
    p.add_argument("--max-cards", type=int, default=30)
    p.add_argument("--headless", action="store_true", default=False)
    p.add_argument("--dry-run", action="store_true", default=False)
    args = p.parse_args()

    asyncio.run(run_scan(args.pages, args.max_cards, args.headless, args.dry_run))

if __name__ == "__main__":
    main()
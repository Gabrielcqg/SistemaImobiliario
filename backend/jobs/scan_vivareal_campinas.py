import asyncio
import sys
import os
import re
import argparse
import hashlib
import logging
import random
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup, NavigableString

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

logger = logging.getLogger("scan_vivareal")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

# URL Fixa
FIXED_URL = "https://www.vivareal.com.br/venda/sp/campinas/?transacao=venda&onde=%2CS%C3%A3o+Paulo%2CCampinas%2C%2C%2C%2C%2Ccity%2CBR%3ESao+Paulo%3ENULL%3ECampinas%2C-22.905082%2C-47.061333%2C&ordem=MOST_RECENT"

# -----------------------------
# 2. Utils
# -----------------------------

def with_page(url: str, page: int) -> str:
    if "page=" in url:
        return re.sub(r"page=\d+", f"page={page}", url)
    else:
        return f"{url}&page={page}"

def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())

def parse_money_brl_to_int(text: str) -> Optional[int]:
    if not text: return None
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None

def extract_external_id(url: str) -> str:
    if not url: return ""
    m = re.search(r"(\d{6,})", url)
    if m: return m.group(1)
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]

def parse_smart_number(text: str) -> Optional[int]:
    if not text: return None
    clean_text = text.replace(".", "")
    match = re.search(r"(\d+)", clean_text)
    return int(match.group(1)) if match else None

def parse_smart_float(text: str) -> Optional[float]:
    if not text: return None
    clean_text = text.replace(".", "").replace(",", ".")
    match = re.search(r"(\d+(\.\d+)?)", clean_text)
    return float(match.group(1)) if match else None

def extract_specs_from_icons(container) -> Dict[str, Any]:
    area_node = container.select_one('li[data-cy="rp-cardProperty-propertyArea-txt"]')
    area_m2 = parse_smart_float(area_node.get_text()) if area_node else None

    bed_node = container.select_one('li[data-cy="rp-cardProperty-bedroomQuantity-txt"]')
    bedrooms = parse_smart_number(bed_node.get_text()) if bed_node else None

    bath_node = container.select_one('li[data-cy="rp-cardProperty-bathroomQuantity-txt"]')
    bathrooms = parse_smart_number(bath_node.get_text()) if bath_node else None

    park_node = container.select_one('li[data-cy="rp-cardProperty-parkingSpacesQuantity-txt"]')
    parking = parse_smart_number(park_node.get_text()) if park_node else None

    return {
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "parking": parking
    }

def parse_cards_from_listing_html(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html or "", "html.parser")
    
    txt = soup.get_text()
    if "Attention Required" in txt or "Why have I been blocked" in txt:
        return []

    cards = soup.select('li[data-cy="rp-property-cd"], .property-card__container, [data-testid="listing-card"]')
    out = []

    for container in cards:
        # 1. URL
        link_elem = container.select_one("a[href]")
        url = link_elem.get("href", "") if link_elem else ""
        if url and not url.startswith("http"): url = "https://www.vivareal.com.br" + url

        # 2. Preço
        price = None
        condo_fee = None
        iptu = None

        price_container = container.select_one('[data-cy="rp-cardProperty-price-txt"]')
        if price_container:
            sale_p = price_container.select_one("p:nth-of-type(1)")
            if sale_p: price = parse_money_brl_to_int(sale_p.get_text())

            fees_p = price_container.select_one("p:nth-of-type(2)")
            if fees_p:
                fees_text = normalize_spaces(fees_p.get_text())
                m_cond = re.search(r"Cond.*?R\$\s*([\d\.,]+)", fees_text, flags=re.I)
                if m_cond: condo_fee = parse_money_brl_to_int(m_cond.group(1))
                m_iptu = re.search(r"IPTU.*?R\$\s*([\d\.,]+)", fees_text, flags=re.I)
                if m_iptu: iptu = parse_money_brl_to_int(m_iptu.group(1))
        else:
            price_node = container.select_one(".property-card__price")
            price = parse_money_brl_to_int(normalize_spaces(price_node.get_text())) if price_node else None

        # 3. Location
        title = None
        neighborhood = None
        city = None
        
        h2_node = container.select_one('h2[data-cy="rp-cardProperty-location-txt"]')
        if h2_node:
            raw_location_text = ""
            for content in h2_node.contents:
                if content.name == "span":
                    title = normalize_spaces(content.get_text())
                elif isinstance(content, NavigableString):
                    raw_location_text += str(content)
            
            clean_loc = raw_location_text.replace('"', '').strip()
            clean_loc = normalize_spaces(clean_loc)
            
            if "," in clean_loc:
                parts = clean_loc.split(",")
                city = parts[-1].strip()
                neighborhood = ",".join(parts[:-1]).strip()
            else:
                neighborhood = clean_loc
                city = "Campinas" 
        else:
            title_node = container.select_one('[data-testid="listing-title"]')
            title = normalize_spaces(title_node.get_text(" ", strip=True)) if title_node else None

        # 4. Rua
        street_node = container.select_one('p[data-cy="rp-cardProperty-street-txt"]')
        address = normalize_spaces(street_node.get_text(" ", strip=True)) if street_node else None

        # 5. Specs
        specs = extract_specs_from_icons(container)
        specs["condo_fee"] = condo_fee
        specs["iptu"] = iptu

        # 6. Check de Preço Abaixo do Mercado
        # Procura o ícone/texto específico
        below_market_node = container.select_one('[data-testid="rp-card-belowPrice-txt"]')
        is_below_market = True if below_market_node else False

        out.append({
            "portal": "vivareal",
            "url": url,
            "external_id": extract_external_id(url),
            "title": title,
            "price": price,
            "location_data": {
                "city": city,
                "neighborhood": neighborhood,
                "address": address,
                "raw": f"{neighborhood}, {city}" if city else neighborhood
            },
            "main_image_url": (container.select_one("img[src]") or {}).get("src"),
            "specs": specs,
            "is_below_market": is_below_market,
            "raw_card_text": container.get_text(" ", strip=True),
        })
    return out

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
        
        # Colunas Planas
        "neighborhood": loc["neighborhood"],
        "city": loc["city"],
        "state": "SP",
        
        "area_m2": specs.get("area_m2"),
        "bedrooms": specs.get("bedrooms"),
        "bathrooms": specs.get("bathrooms"),
        "parking": specs.get("parking"),
        "condo_fee": specs.get("condo_fee"),
        "iptu": specs.get("iptu"),
        
        # NOVA COLUNA (Requer o comando SQL acima)
        "is_below_market": card.get("is_below_market"),
        
        "main_image_url": card.get("main_image_url"),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        
        "full_data": {
            "raw_card_text": card.get("raw_card_text")
        },
    }

# -----------------------------
# 4. Job Principal
# -----------------------------

async def run_scan(pages: int, max_cards_per_page: int, headless: bool, dry_run: bool) -> None:
    sb = None if dry_run else get_supabase_client()
    
    if not dry_run and not sb:
        logger.error("Abortando: Falha ao conectar no Supabase.")
        return

    dump_dir = Path("html_dumps")
    dump_dir.mkdir(exist_ok=True)
    total_written = 0

    for page in range(1, pages + 1):
        fetcher = None
        try:
            logger.info(f"🔄 [INIT] Abrindo navegador para pág {page}...")
            fetcher = StealthFetcher(headless=headless) 
            await asyncio.sleep(2) 

            page_url = with_page(FIXED_URL, page)
            logger.info(f"🌍 [FETCH] Buscando page={page}")
            
            html = await fetcher.fetch(page_url)

            if not html:
                logger.warning(f"⛔ [BLOCK] Cloudflare bloqueou a pág {page}.")
                continue

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            with open(dump_dir / f"page_{page}_{timestamp}.html", "w", encoding="utf-8") as f: 
                f.write(html)

            raw_cards = parse_cards_from_listing_html(html)
            
            if not raw_cards:
                logger.warning(f"⚠️ [VAZIO] HTML ok, mas 0 cards.")
                await asyncio.sleep(5)
                continue

            unique_cards = []
            seen_ids = set()
            for c in raw_cards:
                eid = c.get('external_id')
                if eid and eid not in seen_ids:
                    seen_ids.add(eid)
                    unique_cards.append(c)
            cards = unique_cards
            if max_cards_per_page > 0: cards = cards[:max_cards_per_page]
            
            logger.info(f"✅ [SUCESSO] Pág {page}: {len(cards)} imóveis únicos.")

            logger.info("\n" + "="*60)
            logger.info(f" LISTA DE IMÓVEIS - PÁGINA {page}")
            logger.info("="*60)
            
            for i, c in enumerate(cards, 1):
                loc = c['location_data']
                specs = c['specs']
                p_fmt = f"{c['price']:,}".replace(",", ".") if c['price'] else "N/A"
                
                # Tag visual no log
                below_tag = "🔥 [ABAIXO DO PREÇO]" if c.get('is_below_market') else ""

                logger.info(f"🏠 #{i} | {c['title'] or 'Sem Título'} {below_tag}")
                logger.info(f"   🏘️  {loc['neighborhood']} ({loc['city']})")
                logger.info(f"   📏 {specs['area_m2']}m² | 🛏️ {specs['bedrooms']} qts | 🚿 {specs['bathrooms']} ban | 🚗 {specs['parking']} vagas")
                logger.info(f"   💰 Venda: R$ {p_fmt}")
                logger.info(f"   🔗 {c['url']}")
                logger.info("   " + "-"*40)
            
            logger.info("="*60 + "\n")

            rows = [to_listing_row(c) for c in cards]
            
            if not dry_run and sb and rows:
                BATCH = 50
                for start in range(0, len(rows), BATCH):
                    try:
                        batch = rows[start:start+BATCH]
                        await asyncio.to_thread(sb.table("listings").upsert(batch, on_conflict="portal,external_id").execute)
                    except Exception as db_err:
                        logger.error(f"Erro Supabase: {db_err}")
                total_written += len(rows)
                logger.info(f"💾 [DB] Salvo.")

            if page < pages:
                wait = random.uniform(5.0, 10.0)
                await asyncio.sleep(wait)

        except Exception as e:
            logger.error(f"❌ Erro pág {page}: {e}")
        
        finally:
            if fetcher:
                await fetcher.close()

    logger.info(f"🏁 [FIM] Total Salvos: {total_written}")

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
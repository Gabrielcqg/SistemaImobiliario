"""
Scan Campinas Job: Main CLI entry point for the scraping pipeline.

RESILIENT VERSION for 100+ pages:
- Adaptive backoff: jitter increases when rate limited
- Session rotation: new session after consecutive failures
- Batch processing: pauses between page batches
- Smart retry: exponential backoff on empty_html
- Rate limit detection and recovery

Target: 80%+ success rate across 100 pages (~2500 cards)

Usage:
    python -m jobs.scan_campinas --portals vivareal --pages 100
"""
import asyncio
import argparse
import sys
import os
import random
import re
import time
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Tuple
from bs4 import BeautifulSoup

# curl_cffi for TLS fingerprint bypass
from curl_cffi import requests as cur_requests
from curl_cffi.requests import Session as CurlSession

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from jobs.config import (
    ACTIVE_PORTALS, MAX_PAGES_PER_PORTAL,
    DEFAULT_CITY, DEFAULT_STATE, LISTING_TTL_DAYS
)
from jobs.pipeline.normalizer import normalize_listing, extract_badges_from_text
from jobs.pipeline.upserter import (
    upsert_listing, create_scrape_run, finish_scrape_run, log_scrape
)
from jobs.pipeline.lifecycle import apply_lifecycle

from app.scrapers.vivareal import VivaRealScraper
from app.scrapers.zap import ZapScraper
from app.scrapers.imovelweb import ImovelwebScraper
from app.scrapers.stealth import StealthFetcher

SCRAPERS = {
    "vivareal": VivaRealScraper,
    "zap": ZapScraper,
    "imovelweb": ImovelwebScraper,
}

# -------------------------
# RESILIENT CONFIGURATION
# -------------------------
# Base jitter (will adapt based on rate limiting)
BASE_DETAIL_JITTER = (3.0, 6.5)
MAX_DETAIL_JITTER = (10.0, 18.0)  # Maximum jitter when rate limited

# Batch processing
PAGES_PER_BATCH = 5               # Pages before taking a longer break
BATCH_PAUSE_RANGE = (30, 60)      # Seconds to pause between batches
PAGE_PAUSE_RANGE = (5, 10)        # Seconds between pages

# Session management
ROTATE_SESSION_AFTER_FAILURES = 5  # Rotate session after N consecutive empty_html
ROTATE_SESSION_AFTER_REQUESTS = 100  # Rotate session after N requests

# Retry configuration
MAX_RETRIES_PER_DETAIL = 3        # Max retries for a single detail
RETRY_BACKOFF_BASE = 2.0          # Base for exponential backoff

# Circuit breaker (relaxed for long runs)
DETAIL_BLOCK_ABORT_STREAK = 10    # More lenient for long runs
LISTING_BLOCK_ABORT_PAGES = 3     # Abort after N consecutive listing blocks
MAX_RETRIES_LISTING = 3           # Retries for listing pages

# User-Agent pool for rotation
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
]


def _sleep_range(rng):
    return asyncio.sleep(random.uniform(rng[0], rng[1]))


# -------------------------
# RESILIENT DETAIL FETCHER
# -------------------------
class ResilientDetailFetcher:
    """
    Advanced fetcher with adaptive rate limiting and session management.
    Designed for long scraping sessions (100+ pages).
    """
    
    def __init__(self, impersonate: str = "chrome120"):
        self.impersonate = impersonate
        self.session: Optional[CurlSession] = None
        self.current_user_agent = random.choice(USER_AGENTS)
        
        # Stats
        self.request_count = 0
        self.success_count = 0
        self.empty_count = 0
        self.block_count = 0
        self.session_rotations = 0
        
        # Adaptive state
        self.consecutive_failures = 0
        self.current_jitter = BASE_DETAIL_JITTER
        self.last_referer = None
        self.rate_limited = False
        
        self._ensure_session()
    
    def _ensure_session(self):
        """Create or rotate session."""
        if self.session:
            try:
                self.session.close()
            except:
                pass
        
        self.current_user_agent = random.choice(USER_AGENTS)
        self.session = CurlSession(impersonate=self.impersonate)
        self.session_rotations += 1
        print(f"   🔄 Nova sessão #{self.session_rotations} | UA: ...{self.current_user_agent[-30:]}")
    
    def _maybe_rotate_session(self):
        """Rotate session if needed based on failures or request count."""
        should_rotate = (
            self.consecutive_failures >= ROTATE_SESSION_AFTER_FAILURES or
            self.request_count > 0 and self.request_count % ROTATE_SESSION_AFTER_REQUESTS == 0
        )
        if should_rotate:
            print(f"   ⚠️ Rotacionando sessão (failures={self.consecutive_failures}, requests={self.request_count})")
            self._ensure_session()
            self.consecutive_failures = 0
            # Reset jitter after rotation
            self.current_jitter = BASE_DETAIL_JITTER
            self.rate_limited = False
    
    def _adapt_jitter(self, success: bool):
        """Adapt jitter based on success/failure."""
        if success:
            # Gradually reduce jitter on success
            if self.current_jitter[0] > BASE_DETAIL_JITTER[0]:
                new_min = max(BASE_DETAIL_JITTER[0], self.current_jitter[0] * 0.9)
                new_max = max(BASE_DETAIL_JITTER[1], self.current_jitter[1] * 0.9)
                self.current_jitter = (new_min, new_max)
                self.rate_limited = False
        else:
            # Increase jitter on failure (rate limiting detection)
            if self.current_jitter[0] < MAX_DETAIL_JITTER[0]:
                new_min = min(MAX_DETAIL_JITTER[0], self.current_jitter[0] * 1.5)
                new_max = min(MAX_DETAIL_JITTER[1], self.current_jitter[1] * 1.5)
                self.current_jitter = (new_min, new_max)
                self.rate_limited = True
                print(f"   ⚡ Rate limit detectado! Jitter aumentado para {self.current_jitter[0]:.1f}-{self.current_jitter[1]:.1f}s")
    
    def _get_headers(self, referer: str = None, site_type: str = "same-origin") -> Dict[str, str]:
        """Get headers with current User-Agent."""
        return {
            "Referer": referer or "",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "User-Agent": self.current_user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": site_type,
            "Sec-Fetch-User": "?1",
        }
    
    async def fetch_with_retry(self, url: str, referer: str, max_retries: int = MAX_RETRIES_PER_DETAIL) -> Tuple[str, str]:
        """
        Fetch with automatic retry and exponential backoff.
        Returns: (html, status) where status is 'ok', 'empty', 'blocked', 'error'
        """
        for attempt in range(max_retries):
            self._maybe_rotate_session()
            
            # Calculate jitter for this attempt
            jitter = random.uniform(*self.current_jitter)
            if attempt > 0:
                # Exponential backoff on retries
                jitter *= (RETRY_BACKOFF_BASE ** attempt)
            
            if attempt > 0:
                print(f"      ↻ Retry {attempt+1}/{max_retries} após {jitter:.1f}s...")
            
            await asyncio.sleep(jitter)
            
            try:
                resp = self.session.get(
                    url,
                    headers=self._get_headers(referer),
                    timeout=25
                )
                self.request_count += 1
                
                if resp.status_code == 200 and resp.text and len(resp.text) > 5000:
                    self.success_count += 1
                    self.consecutive_failures = 0
                    self._adapt_jitter(success=True)
                    self.last_referer = url
                    return resp.text, "ok"
                elif resp.status_code == 403:
                    self.block_count += 1
                    self.consecutive_failures += 1
                    self._adapt_jitter(success=False)
                    continue
                else:
                    # Empty or small response (rate limiting)
                    self.empty_count += 1
                    self.consecutive_failures += 1
                    self._adapt_jitter(success=False)
                    continue
                    
            except Exception as e:
                self.consecutive_failures += 1
                self._adapt_jitter(success=False)
                if attempt == max_retries - 1:
                    return "", "error"
                continue
        
        return "", "empty" if self.consecutive_failures > 0 else "blocked"
    
    def fetch_listing(self, url: str, referer: str = None) -> str:
        """Fetch listing page with curl_cffi."""
        try:
            sec_fetch_site = "same-origin" if referer else "none"
            resp = self.session.get(
                url,
                headers=self._get_headers(referer, sec_fetch_site),
                timeout=30
            )
            self.request_count += 1
            if resp.status_code == 200:
                self.success_count += 1
                self.last_referer = url
                return resp.text
            return ""
        except Exception as e:
            print(f"   ⚡ curl_cffi listing error: {e}")
            return ""
    
    def get_stats(self) -> Dict[str, Any]:
        return {
            "requests": self.request_count,
            "success": self.success_count,
            "empty": self.empty_count,
            "blocks": self.block_count,
            "sessions": self.session_rotations,
            "rate_limited": self.rate_limited,
            "current_jitter": self.current_jitter,
        }
    
    def close(self):
        if self.session:
            try:
                self.session.close()
            except:
                pass
            self.session = None


# -------------------------
# Date extraction
# -------------------------
def extract_date_from_detail(html: str) -> Optional[str]:
    """Extract publication date from detail page."""
    if not html:
        return None
    
    soup = BeautifulSoup(html, "html.parser")
    
    # Primary selector
    date_el = soup.find("p", class_="text-neutral-110 text-1-5 font-secondary")
    if date_el:
        return date_el.get_text(strip=True)
    
    # Fallback: regex
    fallback = soup.find(string=re.compile(r"(Publicado há|Atualizado há)", re.I))
    if fallback:
        parent = fallback.find_parent()
        if parent:
            return parent.get_text(strip=True)
    
    return None


def parse_relative_date(text: str) -> Optional[datetime]:
    """Parse relative date text to datetime."""
    if not text:
        return None
    
    pub_match = re.search(r'Publicado\s+há\s*(\d+)\s*(minuto|hora|dia|semana|m[êe]s|ano)', text, re.I)
    if pub_match:
        val = int(pub_match.group(1))
        unit = pub_match.group(2).lower()
        
        multipliers = {
            'minuto': 0, 'hora': 0,
            'dia': 1, 'semana': 7,
            'mês': 30, 'mes': 30,
            'ano': 365
        }
        
        for key, mult in multipliers.items():
            if key in unit:
                days = val * mult if mult > 0 else 0
                return datetime.now(timezone.utc) - timedelta(days=days)
    
    return None


def build_paginated_url(base_url: str, page: int) -> str:
    """Build paginated URL."""
    if page <= 1:
        return base_url
    
    if "?" in base_url:
        if "pagina=" in base_url:
            return re.sub(r'pagina=\d+', f'pagina={page}', base_url)
        else:
            return f"{base_url}&pagina={page}"
    else:
        return f"{base_url}?pagina={page}"


async def collect_cards_from_portal(
    portal: str,
    city: str,
    state: str,
    max_pages: int,
    fetcher: StealthFetcher,
    run_id: str
) -> tuple[List[dict], dict]:
    """
    RESILIENT VERSION: Collect cards with adaptive rate limiting.
    """
    scraper_class = SCRAPERS.get(portal)
    if not scraper_class:
        print(f"❌ Portal desconhecido: {portal}")
        return [], {"status": "unknown_portal"}

    scraper = scraper_class()
    all_cards = []

    filters = {
        "city": city,
        "state": state,
        "operation": "sale",
        "property_type": "apartment",
        "recency_days": 365,
    }

    print(f"\n🔍 [{portal.upper()}] Iniciando varredura RESILIENTE de {city.title()}...")
    print(f"   📊 Configuração: {max_pages} páginas, batch de {PAGES_PER_BATCH}")

    status_meta = {
        "status": "ok",
        "pages_scanned": 0,
        "detail_fetched_count": 0,
        "dates_extracted": 0,
        "dates_missing": 0,
    }

    consecutive_listing_blocks = 0

    # RESILIENT FETCHER
    detail_fetcher = ResilientDetailFetcher(impersonate="chrome120")
    
    start_time = time.time()
    
    try:
        for page in range(1, max_pages + 1):
            # Batch pause
            if page > 1 and (page - 1) % PAGES_PER_BATCH == 0:
                pause = random.uniform(*BATCH_PAUSE_RANGE)
                print(f"\n⏸️  Pausa de batch ({PAGES_PER_BATCH} páginas): {pause:.0f}s...")
                await asyncio.sleep(pause)
                print(f"▶️  Retomando...")
            
            # Check for abort
            if consecutive_listing_blocks >= LISTING_BLOCK_ABORT_PAGES:
                print(f"⛔ Abortando após {consecutive_listing_blocks} bloqueios de listagem")
                status_meta["status"] = "blocked_abort"
                break

            base_url = scraper.build_url(city=city, state=state, filters=filters, page=1)
            url = build_paginated_url(base_url, page)
            
            elapsed = time.time() - start_time
            print(f"\n📄 [{portal.upper()}] Página {page}/{max_pages} [{elapsed/60:.1f}min]: {url[:60]}...")

            html = None
            page_blocked = False
            previous_page_url = detail_fetcher.last_referer

            # Try Playwright first, then curl_cffi fallback
            for attempt in range(MAX_RETRIES_LISTING):
                try:
                    meta = await fetcher.fetch(
                        url, 
                        return_meta=True, 
                        run_id=run_id, 
                        scenario="job", 
                        request_type="list", 
                        page_num=page
                    )
                    html = meta.get("html", "") if isinstance(meta, dict) else meta

                    if not html:
                        print(f"   ⚠️ Tentativa {attempt+1}: HTML vazio")
                        await asyncio.sleep(3 + (2 ** attempt))
                        continue

                    if scraper.is_blocked(html):
                        print(f"   🛡️ Tentativa {attempt+1}: Bloqueio Playwright")
                        page_blocked = True
                        await asyncio.sleep(5 + (2 ** attempt))
                        continue

                    page_blocked = False
                    break

                except Exception as e:
                    print(f"   ❌ Tentativa {attempt+1}: Erro: {e}")
                    await asyncio.sleep(2 ** attempt)

            # FALLBACK: curl_cffi for listing
            if (page_blocked or not html) and page > 1:
                print(f"   🔄 Fallback→curl_cffi para listagem...")
                await asyncio.sleep(random.uniform(5.0, 10.0))
                
                try:
                    html = await asyncio.to_thread(
                        detail_fetcher.fetch_listing,
                        url,
                        previous_page_url
                    )
                    
                    if html and not scraper.is_blocked(html):
                        print(f"   ✅ curl_cffi listing OK ({len(html)//1000}KB)")
                        page_blocked = False
                    else:
                        print(f"   ❌ curl_cffi listing também bloqueado")
                        page_blocked = True
                except Exception as e:
                    print(f"   ❌ curl_cffi error: {e}")
                    page_blocked = True

            if page_blocked or not html:
                print(f"🚫 Falha na página {page}")
                consecutive_listing_blocks += 1
                if page == 1:
                    status_meta["status"] = "blocked_initial"
                    break
                continue
            else:
                consecutive_listing_blocks = 0

            # Parse cards
            try:
                scraper.last_search_url = url
                cards = scraper.parse_cards(html, recency_days=365)
            except Exception as e:
                print(f"⚠️ Erro ao parsear página {page}: {e}")
                continue

            status_meta["pages_scanned"] += 1

            if not cards:
                print(f"⚠️ Página {page}: Nenhum card")
                continue

            print(f"✅ Página {page}: {len(cards)} cards | Jitter: {detail_fetcher.current_jitter[0]:.1f}-{detail_fetcher.current_jitter[1]:.1f}s")

            # Update max_pages
            if page == 1:
                total_pages = scraper.extract_total_pages(html)
                if total_pages and total_pages < max_pages:
                    max_pages = total_pages
                    print(f"📊 Total disponível: {total_pages} páginas")

            # CARD PROCESSING
            for i, card in enumerate(cards, 1):
                # City filter
                if card.location and card.location.city:
                    import unicodedata
                    def norm(txt):
                        if not txt: return ""
                        t = unicodedata.normalize('NFKD', txt).encode('ascii', 'ignore').decode('utf-8')
                        return t.lower().strip()
                    
                    if norm(card.location.city) and norm(card.location.city) != norm(city):
                        continue

                card_dict = {
                    "portal": portal,
                    "external_id": card.external_id,
                    "url": card.url,
                    "title": card.title,
                    "price": card.price,
                    "area_m2": card.specs.area if card.specs else None,
                    "bedrooms": card.specs.bedrooms if card.specs else None,
                    "bathrooms": card.specs.bathrooms if card.specs else None,
                    "parking": card.specs.parking if card.specs else None,
                    "neighborhood": card.location.neighborhood if card.location else None,
                    "city": card.location.city if (card.location and card.location.city) else city,
                    "state": card.location.state if (card.location and card.location.state) else state,
                    "main_image_url": card.main_image_url,
                    "agency_name": card.agency_name,
                    "published_days_ago": card.published_days_ago,
                    "published_at": card.published_at.isoformat() if card.published_at else None,
                    "published_at_source": None,
                }

                # Check if date already in listing
                if card_dict.get("published_at"):
                    card_dict["published_at_source"] = "listing_json"
                    status_meta["dates_extracted"] += 1
                else:
                    # FETCH DETAIL with retry
                    if card.url:
                        print(f"   [{i}/{len(cards)}]", end=" ", flush=True)
                        
                        detail_html, fetch_status = await detail_fetcher.fetch_with_retry(
                            card.url,
                            url
                        )
                        
                        status_meta["detail_fetched_count"] += 1
                        
                        if fetch_status == "ok":
                            date_text = extract_date_from_detail(detail_html)
                            if date_text:
                                card_dict["date_text"] = date_text
                                parsed_dt = parse_relative_date(date_text)
                                if parsed_dt:
                                    card_dict["published_at"] = parsed_dt.isoformat()
                                    card_dict["published_at_source"] = "detail_extracted"
                                    status_meta["dates_extracted"] += 1
                                    print(f"✅ {date_text[:30]}")
                                else:
                                    card_dict["published_at_source"] = "detail_text_unparsed"
                                    status_meta["dates_missing"] += 1
                                    print(f"⚠️ unparsed: {date_text[:30]}")
                            else:
                                card_dict["published_at_source"] = "detail_not_found"
                                status_meta["dates_missing"] += 1
                                print(f"❌ date not found")
                            
                            # Also extract other details
                            try:
                                details = scraper.extract_details(detail_html) or {}
                                if details.get("advertiser") and not card_dict.get("agency_name"):
                                    card_dict["agency_name"] = details["advertiser"]
                            except:
                                pass
                        else:
                            card_dict["published_at_source"] = f"fetch_{fetch_status}"
                            status_meta["dates_missing"] += 1
                            print(f"❌ {fetch_status}")

                if not card_dict.get("published_at"):
                    if not card_dict.get("published_at_source"):
                        card_dict["published_at_source"] = "unavailable"

                all_cards.append(card_dict)

            # Page pause
            await _sleep_range(PAGE_PAUSE_RANGE)

            # Print intermediate stats every 10 pages
            if page % 10 == 0:
                stats = detail_fetcher.get_stats()
                success_rate = (status_meta["dates_extracted"] / max(1, status_meta["dates_extracted"] + status_meta["dates_missing"])) * 100
                print(f"\n📈 [STATS] Pág {page}: {len(all_cards)} cards | {success_rate:.0f}% datas | Sessions: {stats['sessions']} | Jitter: {stats['current_jitter']}")

    finally:
        stats = detail_fetcher.get_stats()
        detail_fetcher.close()

    elapsed_total = time.time() - start_time
    success_rate = (status_meta["dates_extracted"] / max(1, status_meta["dates_extracted"] + status_meta["dates_missing"])) * 100
    
    print(f"\n📊 [{portal.upper()}] RESUMO FINAL")
    print(f"   ⏱️  Tempo: {elapsed_total/60:.1f} min")
    print(f"   📦 Cards: {len(all_cards)}")
    print(f"   📅 Datas: {status_meta['dates_extracted']}/{status_meta['dates_extracted']+status_meta['dates_missing']} ({success_rate:.0f}%)")
    print(f"   🔄 Sessões: {stats['sessions']}")
    print(f"   📡 Requests: {stats['requests']} ({stats['success']} OK, {stats['empty']} empty, {stats['blocks']} blocked)")
    
    return all_cards, status_meta


async def run_scan(
    city: str = DEFAULT_CITY,
    state: str = DEFAULT_STATE,
    portals: List[str] = None,
    max_pages: int = MAX_PAGES_PER_PORTAL
):
    """Main scan function."""
    if portals is None:
        portals = ACTIVE_PORTALS

    print("=" * 70)
    print(f"🚀 SCRAPER RESILIENTE - {city.upper()}/{state.upper()}")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🌐 Portais: {', '.join(portals)}")
    print(f"📄 Páginas: {max_pages}")
    print("=" * 70)

    run_id = None
    try:
        run_id = create_scrape_run(city=city, portals=portals)
        print(f"🆔 Run ID: {run_id}")
    except Exception as e:
        import uuid
        run_id = str(uuid.uuid4())
        print(f"⚠️ DB offline, ID local: {run_id}")

    fetcher = StealthFetcher(headless=True)
    
    all_results = []
    portal_status = {}

    try:
        for portal in portals:
            cards, status = await collect_cards_from_portal(
                portal=portal,
                city=city,
                state=state,
                max_pages=max_pages,
                fetcher=fetcher,
                run_id=run_id
            )
            
            portal_status[portal] = status.get("status", "unknown")
            
            if not cards:
                print(f"⚠️ [{portal.upper()}] Nenhum card")
                continue

            # Save cards
            saved = 0
            start_time = datetime.now()
            
            for card_dict in cards:
                try:
                    normalized = normalize_listing(card_dict)
                    if normalized:
                        result = upsert_listing(normalized)
                        if result:
                            saved += 1
                except Exception as e:
                    pass

            elapsed = (datetime.now() - start_time).total_seconds() * 1000
            print(f"💾 [{portal.upper()}] {saved} cards salvos em {elapsed:.0f}ms")
            
            all_results.extend(cards)

    finally:
        await fetcher.close()
        print("👤 Sessão Playwright encerrada")

    print("\n🔄 Aplicando lifecycle...")
    try:
        apply_lifecycle()
    except Exception as e:
        print(f"⚠️ Erro lifecycle: {e}")

    if run_id:
        try:
            finish_scrape_run(
                run_id=run_id,
                total_cards=len(all_results),
                status="completed" if all_results else "no_results"
            )
        except:
            pass

    print("\n" + "=" * 70)
    print("✅ PIPELINE CONCLUÍDO")
    print(f"📦 Total: {len(all_results)} cards")
    for p, s in portal_status.items():
        print(f"   - {p}: {s.upper()}")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Resilient Campinas Scraper")
    parser.add_argument("--city", default=DEFAULT_CITY)
    parser.add_argument("--state", default=DEFAULT_STATE)
    parser.add_argument("--portals", type=str, default=None)
    parser.add_argument("--pages", type=int, default=MAX_PAGES_PER_PORTAL)
    
    args = parser.parse_args()
    portals = args.portals.split(",") if args.portals else None
    
    asyncio.run(run_scan(
        city=args.city,
        state=args.state,
        portals=portals,
        max_pages=args.pages
    ))


if __name__ == "__main__":
    main()

"""
Scan Campinas V2 - Stealth Listing-Only Job

Collects real estate listings from VivaReal, Zap, and Imovelweb.

V2 Features:
- NO detail page fetching (listing data only) - faster, less detection
- NO published_at extraction for VivaReal/Zap
- Advanced anti-detection with StealthFetcher:
  * User-Agent rotation
  * Viewport randomization
  * Human behavior simulation (mouse, scroll)
  * Session rotation every 5 pages
- Direct database insertion after each page
- Adaptive delays (3-8s) to simulate human browsing

Usage:
    python -m jobs.scan_campinas_v2 --pages 10 --portals imovelweb,vivareal,zap

Exit Codes:
    0 = Success
    1 = Partial failure (some portals blocked)
    2 = Complete failure (all portals blocked)
"""
import asyncio
import argparse
import os
import sys
import time
import random
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.scrapers.v2.vivareal_listing_only import VivaRealListingOnlyScraper
from app.scrapers.v2.zap_listing_only import ZapListingOnlyScraper
from app.scrapers.imovelweb import ImovelwebScraper

# StealthFetcher for JS-rendered pages
try:
    from app.scrapers.stealth import StealthFetcher
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False
    print("⚠️ StealthFetcher not available - VivaReal/Zap may not work")

# Optional DB imports (graceful fallback if unavailable)
try:
    from jobs.pipeline.normalizer import normalize_listing
    from jobs.pipeline.upserter import upsert_listing, create_scrape_run, finish_scrape_run
    HAS_DB = True
except ImportError:
    HAS_DB = False


# =========================================================================
# CONFIGURATION
# =========================================================================
DEFAULT_PAGES = 10
DEFAULT_PORTALS = ["imovelweb", "vivareal", "zap"]
DEFAULT_CITY = "Campinas"
DEFAULT_STATE = "SP"

# Rate limiting - Human-like delays
JITTER_RANGE = (3.0, 8.0)         # Seconds between pages (human-like browsing)
REQUEST_TIMEOUT = 30.0            # HTTP timeout

# Retry configuration
MAX_RETRIES = 2                   # Extra retries per page
BACKOFF_BASE = 2.0                # Exponential backoff base

# Debug output
DEBUG_DIR = Path("./debug/scan_v2")

# Portals that require JavaScript rendering
JS_RENDERED_PORTALS = ["vivareal", "zap", "imovelweb"]  # All need StealthFetcher for Cloudflare

# HTTP headers (standard browser)
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


# =========================================================================
# SCRAPERS REGISTRY
# =========================================================================
def get_scraper(portal: str):
    """Get the appropriate scraper for the portal."""
    scrapers = {
        "vivareal": VivaRealListingOnlyScraper,
        "zap": ZapListingOnlyScraper,
        "imovelweb": ImovelwebScraper,
    }
    scraper_class = scrapers.get(portal.lower())
    if scraper_class:
        return scraper_class()
    return None


# =========================================================================
# HTTP CLIENT
# =========================================================================
class ListingFetcher:
    """
    Simple HTTP client for listing pages.
    Uses httpx with persistent session (cookies).
    No WAF bypass - just standard requests.
    """

    def __init__(self, run_id: str):
        self.run_id = run_id
        self.client = httpx.Client(
            headers=DEFAULT_HEADERS,
            timeout=REQUEST_TIMEOUT,
            follow_redirects=True,
        )
        self.request_count = 0
        self.success_count = 0
        self.blocked_count = 0

    def fetch(self, url: str, portal: str, page: int) -> Tuple[str, int, Optional[str]]:
        """
        Fetch a listing page.
        Returns: (html, status_code, error_reason)
        """
        error_reason = None

        for attempt in range(MAX_RETRIES + 1):
            try:
                # Apply jitter
                if attempt > 0:
                    backoff = BACKOFF_BASE * (2 ** (attempt - 1))
                    time.sleep(backoff)

                self.request_count += 1

                resp = self.client.get(url)
                html = resp.text
                status = resp.status_code

                if status == 200:
                    self.success_count += 1
                    return html, status, None

                if status in (403, 429):
                    self.blocked_count += 1
                    error_reason = f"http_{status}"
                    continue

                error_reason = f"http_{status}"
                continue

            except httpx.TimeoutException:
                error_reason = "timeout"
                continue
            except Exception as e:
                error_reason = f"error_{type(e).__name__}"
                continue

        return "", 0, error_reason

    def close(self):
        if self.client:
            self.client.close()

    def get_stats(self) -> Dict[str, int]:
        return {
            "requests": self.request_count,
            "success": self.success_count,
            "blocked": self.blocked_count,
        }


# =========================================================================
# DEBUG DUMP
# =========================================================================
def save_debug_dump(
    run_id: str,
    portal: str,
    page: int,
    html: str,
    status_code: int,
    reason: str
):
    """Save blocked/failed page HTML for debugging."""
    debug_path = DEBUG_DIR / run_id / portal
    debug_path.mkdir(parents=True, exist_ok=True)

    filename = f"page_{page}_{reason}.html"
    filepath = debug_path / filename

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"<!-- Status: {status_code}, Reason: {reason} -->\n")
        f.write(html or "<!-- Empty response -->")

    return filepath


# =========================================================================
# CARD PRINTING (FULL DUMP)  ✅ MOD
# =========================================================================
def _sanitize_for_print(v, max_str: int = 280, max_list: int = 30, max_depth: int = 5, _depth: int = 0):
    """Evita log infinito: imprime tudo, mas trunca strings/listas gigantes."""
    if _depth >= max_depth:
        return f"<max_depth:{max_depth}>"

    if v is None:
        return None

    # datetime-like
    if hasattr(v, "isoformat") and callable(getattr(v, "isoformat")):
        try:
            return v.isoformat()
        except Exception:
            return str(v)

    if isinstance(v, (int, float, bool)):
        return v

    if isinstance(v, str):
        if len(v) <= max_str:
            return v
        return v[:max_str] + f"... <+{len(v) - max_str} chars>"

    if isinstance(v, list):
        if len(v) <= max_list:
            return [_sanitize_for_print(x, max_str, max_list, max_depth, _depth + 1) for x in v]
        head = [_sanitize_for_print(x, max_str, max_list, max_depth, _depth + 1) for x in v[:max_list]]
        head.append(f"... <+{len(v) - max_list} items>")
        return head

    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            out[str(k)] = _sanitize_for_print(val, max_str, max_list, max_depth, _depth + 1)
        return out

    return str(v)


def ensure_url_key(card: Dict[str, Any], portal: str) -> None:
    """Garante que exista card['url'] mesmo se vier como link/href/permalink."""
    if not isinstance(card, dict):
        return

    if card.get("url"):
        return

    for k in ("link", "href", "detail_url", "permalink", "listing_url"):
        if card.get(k):
            card["url"] = card.get(k)
            break

    url = card.get("url")
    if not url:
        return

    base = PORTAL_HOMEPAGES.get(portal.lower())
    if base and isinstance(url, str):
        if url.startswith("/"):
            card["url"] = base.rstrip("/") + url
        elif url.startswith("//"):
            card["url"] = "https:" + url


def print_cards_full(cards: List[Dict[str, Any]], portal: str, limit: Optional[int] = None):
    """
    Imprime TODOS os campos do card (inclusive url).
    limit=None -> imprime todos; limit=N -> imprime N cards.
    """
    show = cards if limit is None else cards[:limit]

    for i, card in enumerate(show, 1):
        ensure_url_key(card, portal)
        sanitized = _sanitize_for_print(card)
        print(f"\n{'='*70}")
        print(f"🏠 CARD {i}/{len(cards)} [{portal.upper()}]")
        print(f"🔗 URL: {card.get('url', 'N/A')}")
        print(f"💰 Preço: R$ {card.get('price', 'N/A')}")
        print(f"📍 Bairro: {card.get('neighborhood', 'N/A')} | Cidade: {card.get('city', 'N/A')} | Estado: {card.get('state', 'N/A')}")
        print(f"🛏️ Quartos: {card.get('bedrooms', 'N/A')} | 🚿 Banheiros: {card.get('bathrooms', 'N/A')} | 🚗 Vagas: {card.get('parking', 'N/A')} | 📐 Área: {card.get('area_m2', 'N/A')}m²")
        print(f"🖼️ Imagem: {card.get('main_image_url', 'N/A')[:80]}..." if card.get('main_image_url') else "🖼️ Imagem: N/A")
        print(f"{'='*70}")
        print("📋 Dados completos:")
        print(json.dumps(sanitized, ensure_ascii=False, indent=2, sort_keys=True, default=str))


# =========================================================================
# MAIN COLLECTION LOGIC
# =========================================================================
async def collect_portal(
    portal: str,
    city: str,
    state: str,
    max_pages: int,
    fetcher: ListingFetcher,
    run_id: str,
    save_to_db: bool = True,
) -> Dict[str, Any]:
    """
    Collect listings from a single portal.
    Returns stats dict.
    """
    scraper = get_scraper(portal)
    if not scraper:
        print(f"❌ Unknown portal: {portal}")
        return {"status": "unknown_portal", "cards": []}

    scraper.reset_stats() if hasattr(scraper, "reset_stats") else None

    all_cards = []

    print(f"\n{'='*60}")
    print(f"📡 [{portal.upper()}] Starting scan: {city}, {state}")
    print(f"   Pages: {max_pages} | City: {city} | State: {state}")
    print(f"{'='*60}")

    consecutive_blocks = 0

    for page in range(1, max_pages + 1):
        # Build URL
        if portal == "imovelweb":
            url = scraper.build_url(
                city=city,
                state=state,
                filters={"operation": "sale", "property_type": "apartment"},
                page=page
            )
        else:
            url = scraper.build_url(city=city, state=state, page=page)

        print(f"\n📄 Page {page}/{max_pages}: {url[:80]}...")

        # Apply jitter between pages
        if page > 1:
            jitter = random.uniform(*JITTER_RANGE)
            await asyncio.sleep(jitter)

        # Fetch page
        html, status_code, error_reason = fetcher.fetch(url, portal, page)

        # Track stats
        if hasattr(scraper, "stats"):
            scraper.stats["pages_attempted"] = scraper.stats.get("pages_attempted", 0) + 1

        # Check for block/error
        is_blocked = False
        if error_reason:
            is_blocked = True
            print(f"   ❌ FAILED: {error_reason} (status={status_code})")
        elif hasattr(scraper, "is_blocked") and scraper.is_blocked(html):
            is_blocked = True
            block_reason = scraper.get_block_reason(html, status_code) if hasattr(scraper, "get_block_reason") else "blocked"
            error_reason = block_reason
            print(f"   🛡️ BLOCKED: {block_reason}")

        if is_blocked:
            # Save debug dump
            save_debug_dump(run_id, portal, page, html, status_code, error_reason or "unknown")

            consecutive_blocks += 1
            if hasattr(scraper, "stats"):
                scraper.stats["pages_blocked"] = scraper.stats.get("pages_blocked", 0) + 1
                scraper.stats["failure_reasons"][error_reason] = \
                    scraper.stats["failure_reasons"].get(error_reason, 0) + 1

            # Abort after 2 consecutive blocks
            if consecutive_blocks >= 2:
                print(f"   ⛔ Aborting portal after {consecutive_blocks} consecutive blocks")
                break

            continue

        # Success - reset block counter
        consecutive_blocks = 0
        if hasattr(scraper, "stats"):
            scraper.stats["pages_ok"] = scraper.stats.get("pages_ok", 0) + 1

        # Parse cards
        try:
            if portal == "imovelweb":
                # Imovelweb uses different parse signature
                cards = scraper.parse_cards(html, recency_days=365)
                # Convert OfferCard to dict
                cards = [card_to_dict(c, portal) for c in cards]
            else:
                cards = scraper.parse_cards(html)
        except Exception as e:
            print(f"   ⚠️ Parse error: {e}")
            cards = []

        cards_count = len(cards)
        print(f"   ✅ OK: {len(html)//1000}KB HTML, {cards_count} cards parsed")

        # ✅ MOD: Print FULL cards (first 2 by default)
        if cards_count > 0:
            print_cards_full(cards, portal)  # Print ALL cards with URL and details

        all_cards.extend(cards)

    # Calculate field coverage
    if hasattr(scraper, "calculate_field_coverage"):
        scraper.calculate_field_coverage(all_cards)

    # Get final stats
    stats = scraper.get_stats() if hasattr(scraper, "get_stats") else {}
    stats["total_cards"] = len(all_cards)
    stats["cards"] = all_cards

    # Determine status
    if stats.get("pages_blocked", 0) == stats.get("pages_attempted", 0):
        stats["status"] = "blocked"
    elif stats.get("pages_blocked", 0) > 0:
        stats["status"] = "partial"
    else:
        stats["status"] = "ok"

    # Save to DB (if available)
    if save_to_db and HAS_DB and all_cards:
        saved = 0
        for card_dict in all_cards:
            try:
                normalized = normalize_listing(card_dict)
                if normalized:
                    result = upsert_listing(normalized)
                    if result:
                        saved += 1
            except Exception:
                pass
        print(f"\n💾 [{portal.upper()}] Saved {saved}/{len(all_cards)} cards to DB")

    return stats


def card_to_dict(card, portal: str) -> Dict[str, Any]:
    """Convert OfferCard model to dict (for Imovelweb compatibility)."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "external_id": card.external_id,
        "portal": portal,
        "url": card.url,
        "title": card.title,
        "price": card.price,
        "condo_fee": None,
        "iptu": None,
        "area_m2": card.specs.area if card.specs else None,
        "bedrooms": card.specs.bedrooms if card.specs else None,
        "bathrooms": card.specs.bathrooms if card.specs else None,
        "parking": card.specs.parking if card.specs else None,
        "property_type": "apartment",
        "street": None,
        "neighborhood": card.location.neighborhood if card.location else None,
        "city": card.location.city if card.location else None,
        "state": card.location.state if card.location else None,
        "latitude": None,
        "longitude": None,
        "main_image_url": card.main_image_url,
        "images": [card.main_image_url] if card.main_image_url else [],
        "advertiser": card.agency_name,
        "published_at": card.published_at.isoformat() if card.published_at else None,
        "first_seen_at": now,
        "last_seen_at": now,
    }


def print_final_stats(portal_stats: Dict[str, Dict]):
    """Print final statistics summary."""
    print("\n" + "=" * 70)
    print("📊 FINAL STATISTICS")
    print("=" * 70)

    total_cards = 0
    total_parsed = 0

    for portal, stats in portal_stats.items():
        print(f"\n🔹 [{portal.upper()}]")
        print(f"   Status: {stats.get('status', 'unknown').upper()}")
        print(f"   Pages: {stats.get('pages_ok', 0)}/{stats.get('pages_attempted', 0)} OK")
        print(f"   Blocked: {stats.get('pages_blocked', 0)}")

        found = stats.get('total_cards_found', 0)
        parsed = stats.get('total_cards_parsed', 0) or stats.get('total_cards', 0)
        success_rate = stats.get('success_rate', 0)
        if found > 0 and success_rate == 0:
            success_rate = parsed / found * 100

        print(f"   Cards: {parsed} parsed / {found} found ({success_rate:.1f}% success)")

        # Field coverage
        coverage = stats.get('field_coverage', {})
        if coverage:
            print("   Field Coverage:")
            for field, pct in sorted(coverage.items(), key=lambda x: -x[1])[:5]:
                bar = "█" * int(pct / 10) + "░" * (10 - int(pct / 10))
                print(f"      {field:15} {bar} {pct:.0f}%")

        # Failure reasons
        failures = stats.get('failure_reasons', {})
        if failures:
            print("   Top Failures:")
            for reason, count in sorted(failures.items(), key=lambda x: -x[1])[:3]:
                print(f"      {reason}: {count}")

        total_cards += found
        total_parsed += parsed

    print("\n" + "-" * 70)
    overall_rate = (total_parsed / total_cards * 100) if total_cards > 0 else 0
    print(f"📦 TOTAL: {total_parsed}/{total_cards} cards ({overall_rate:.1f}% success)")

    # Check if meets criteria
    if overall_rate >= 80:
        print("✅ SUCCESS: Met 80% threshold")
        return 0
    else:
        print("⚠️ BELOW TARGET: Did not meet 80% threshold")
        return 1


# =========================================================================
# MAIN ENTRY POINT
# =========================================================================
async def run_scan_v2(
    city: str = DEFAULT_CITY,
    state: str = DEFAULT_STATE,
    portals: List[str] = None,
    max_pages: int = DEFAULT_PAGES,
    save_to_db: bool = True,
    headless: bool = True,
):
    """Main scan function."""
    if portals is None:
        portals = DEFAULT_PORTALS

    # Generate run ID
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    print("=" * 70)
    print("🚀 SCAN CAMPINAS V2 - LISTING ONLY")
    print("=" * 70)
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🆔 Run ID: {run_id}")
    print(f"🌐 Portals: {', '.join(portals)}")
    print(f"📄 Pages per portal: {max_pages}")
    print(f"📍 Location: {city}, {state}")
    print(f"💾 Save to DB: {save_to_db and HAS_DB}")
    print(f"🎭 StealthFetcher: {'Available' if HAS_STEALTH else 'NOT AVAILABLE'}")
    print("=" * 70)

    # Create scrape run in DB
    db_run_id = None
    if HAS_DB:
        try:
            db_run_id = create_scrape_run(city=city, state=state, portals=portals)
            print(f"📊 DB Run ID: {db_run_id}")
        except Exception as e:
            print(f"⚠️ DB run creation failed: {e}")

    portal_stats = {}

    # Separate portals by type
    js_portals = [p for p in portals if p.lower() in JS_RENDERED_PORTALS]
    http_portals = [p for p in portals if p.lower() not in JS_RENDERED_PORTALS]

    # Process HTTP-based portals (Imovelweb)
    if http_portals:
        print(f"\n📡 HTTP-based portals: {', '.join(http_portals)}")
        fetcher = ListingFetcher(run_id)
        try:
            for portal in http_portals:
                stats = await collect_portal(
                    portal=portal,
                    city=city,
                    state=state,
                    max_pages=max_pages,
                    fetcher=fetcher,
                    run_id=run_id,
                    save_to_db=save_to_db,
                )
                portal_stats[portal] = stats
        finally:
            fetcher.close()

    # Process JS-rendered portals (VivaReal, Zap, Imovelweb if included)
    if js_portals:
        print(f"\n🎭 JS-rendered portals: {', '.join(js_portals)}")
        if not HAS_STEALTH:
            print("❌ StealthFetcher not available - skipping JS portals")
            for portal in js_portals:
                portal_stats[portal] = {"status": "no_stealth", "total_cards": 0}
        else:
            stealth = StealthFetcher(headless=headless)
            try:
                for portal in js_portals:
                    stats = await collect_portal_stealth(
                        portal=portal,
                        city=city,
                        state=state,
                        max_pages=max_pages,
                        fetcher=stealth,
                        run_id=run_id,
                        save_to_db=save_to_db,
                    )
                    portal_stats[portal] = stats
            finally:
                await stealth.close()
                print("🎭 StealthFetcher closed")

    # Print final statistics
    exit_code = print_final_stats(portal_stats)

    # Finish DB run
    if HAS_DB and db_run_id:
        try:
            total_cards = sum(s.get("total_cards", 0) for s in portal_stats.values())
            finish_scrape_run(
                run_id=db_run_id,
                total_cards=total_cards,
                status="completed" if exit_code == 0 else "partial"
            )
        except Exception as e:
            print(f"⚠️ DB run finish failed: {e}")

    print("\n" + "=" * 70)
    print("✅ SCAN V2 COMPLETE")
    print("=" * 70)

    return exit_code


# Portal homepage URLs for warm-up
PORTAL_HOMEPAGES = {
    "vivareal": "https://www.vivareal.com.br/",
    "zap": "https://www.zapimoveis.com.br/",
    "imovelweb": "https://www.imovelweb.com.br/",
}


async def warmup_homepage(fetcher, portal: str, run_id: str):
    """
    Visit portal homepage to build legitimate cookies and Cloudflare clearance.
    This simulates a user arriving at the site naturally before browsing listings.
    """
    homepage = PORTAL_HOMEPAGES.get(portal.lower())
    if not homepage:
        return

    print(f"\n🏠 [WARMUP] Visiting {portal} homepage for cookie warmup...")

    try:
        meta = await fetcher.fetch(
            homepage,
            return_meta=True,
            run_id=run_id,
            scenario="warmup",
            request_type="homepage",
            simulate_human=True,
        )

        if meta and meta.get("status") == 200:
            print(f"   ✅ Homepage loaded ({meta.get('cookies_count', 0)} cookies)")
            # Longer pause to let Cloudflare cookies fully settle
            wait_time = random.uniform(5.0, 8.0)
            print(f"   ⏳ Waiting {wait_time:.1f}s for CF cookies to settle...")
            await asyncio.sleep(wait_time)
        else:
            print(f"   ⚠️ Homepage returned status {meta.get('status', 'unknown')}")
    except Exception as e:
        print(f"   ⚠️ Homepage warmup failed: {e}")


async def collect_portal_stealth(
    portal: str,
    city: str,
    state: str,
    max_pages: int,
    fetcher,  # StealthFetcher
    run_id: str,
    save_to_db: bool = True,
) -> Dict[str, Any]:
    """
    Collect listings from a JS-rendered portal using StealthFetcher.
    """
    scraper = get_scraper(portal)
    if not scraper:
        print(f"❌ Unknown portal: {portal}")
        return {"status": "unknown_portal", "cards": []}

    if hasattr(scraper, "reset_stats"):
        scraper.reset_stats()

    all_cards = []

    print(f"\n{'='*60}")
    print(f"🎭 [{portal.upper()}] Starting JS-rendered scan: {city}, {state}")
    print(f"   Pages: {max_pages} | City: {city} | State: {state}")
    print(f"{'='*60}")

    consecutive_blocks = 0
    pages_attempted = 0
    pages_ok = 0
    pages_blocked = 0

    # Homepage warm-up: Visit portal homepage first to build cookies/clearance
    await warmup_homepage(fetcher, portal, run_id)

    for page in range(1, max_pages + 1):
        # Build URL (handle different scraper signatures)
        if portal.lower() == "imovelweb":
            url = scraper.build_url(
                city=city,
                state=state,
                filters={"operation": "sale", "property_type": "apartment"},
                page=page
            )
        else:
            url = scraper.build_url(city=city, state=state, page=page)

        print(f"\n📄 Page {page}/{max_pages}: {url[:80]}...")

        # Apply jitter between pages
        if page > 1:
            jitter = random.uniform(*JITTER_RANGE)
            print(f"   ⏳ Waiting {jitter:.1f}s...")
            await asyncio.sleep(jitter)

        pages_attempted += 1

        # Define wait selector based on portal (for JS-rendered content)
        wait_selector = None
        if portal.lower() == "vivareal":
            wait_selector = '.olx-core-surface, .listings-wrapper'
        elif portal.lower() == "zap":
            wait_selector = '[data-testid="listing-card"], .olx-core-surface'
        elif portal.lower() == "imovelweb":
            wait_selector = '[data-posting-type], .posting-card, article[data-qa]'

        # Fetch page with StealthFetcher
        html = None
        error_reason = None

        for attempt in range(MAX_RETRIES + 1):
            try:
                if attempt > 0:
                    backoff = BACKOFF_BASE * (2 ** (attempt - 1))
                    print(f"   ↻ Retry {attempt}/{MAX_RETRIES} after {backoff:.1f}s...")
                    await asyncio.sleep(backoff)

                meta = await fetcher.fetch(
                    url,
                    return_meta=True,
                    run_id=run_id,
                    scenario="v2",
                    request_type="list",
                    page_num=page,
                    wait_for_selector=wait_selector,
                    wait_timeout=15000  # 15s timeout for content render
                )

                if isinstance(meta, dict):
                    html = meta.get("html", "")
                else:
                    html = meta

                if html and len(html) > 1000:
                    break
                else:
                    error_reason = "empty_html"

            except Exception as e:
                error_reason = f"fetch_error_{type(e).__name__}"
                print(f"   ❌ Fetch error: {e}")

        # Check for block
        is_blocked = False
        if not html:
            is_blocked = True
            error_reason = error_reason or "empty_response"
        elif hasattr(scraper, "is_blocked") and scraper.is_blocked(html):
            is_blocked = True
            error_reason = scraper.get_block_reason(html, 200) if hasattr(scraper, "get_block_reason") else "blocked"

        if is_blocked:
            print(f"   🛡️ BLOCKED: {error_reason}")
            save_debug_dump(run_id, portal, page, html or "", 0, error_reason or "unknown")

            consecutive_blocks += 1
            pages_blocked += 1

            if hasattr(scraper, "stats"):
                scraper.stats["failure_reasons"] = scraper.stats.get("failure_reasons", {})
                scraper.stats["failure_reasons"][error_reason] = \
                    scraper.stats["failure_reasons"].get(error_reason, 0) + 1

            # Abort after 2 consecutive blocks
            if consecutive_blocks >= 2:
                print(f"   ⛔ Aborting portal after {consecutive_blocks} consecutive blocks")
                break

            continue

        # Success
        consecutive_blocks = 0
        pages_ok += 1

        # Parse cards
        try:
            if portal.lower() == "imovelweb":
                cards = scraper.parse_cards(html, recency_days=365)
                cards = [card_to_dict(c, portal) for c in cards]
            else:
                cards = scraper.parse_cards(html)
        except Exception as e:
            print(f"   ⚠️ Parse error: {e}")
            cards = []

        cards_count = len(cards)
        print(f"   ✅ OK: {len(html)//1000}KB HTML, {cards_count} cards parsed")

        # ✅ MOD: Print FULL cards with URL and all details
        if cards_count > 0:
            print_cards_full(cards, portal)  # Print ALL cards

        # Incremental DB insertion (insert after each page for reliability)
        if save_to_db and HAS_DB and cards:
            inserted = 0
            for card in cards:
                try:
                    normalized = normalize_listing(card)
                    upsert_listing(normalized)
                    inserted += 1
                except Exception as e:
                    logger.debug(f"DB insert error: {e}")
            print(f"   💾 Inserted {inserted}/{len(cards)} cards to DB")

        all_cards.extend(cards)

    # Update stats
    if hasattr(scraper, "stats"):
        scraper.stats["pages_attempted"] = pages_attempted
        scraper.stats["pages_ok"] = pages_ok
        scraper.stats["pages_blocked"] = pages_blocked

    # Calculate field coverage
    if hasattr(scraper, "calculate_field_coverage"):
        scraper.calculate_field_coverage(all_cards)

    # Get final stats
    stats = scraper.get_stats() if hasattr(scraper, "get_stats") else {}
    stats["pages_attempted"] = pages_attempted
    stats["pages_ok"] = pages_ok
    stats["pages_blocked"] = pages_blocked
    stats["total_cards"] = len(all_cards)
    stats["cards"] = all_cards

    # Determine status
    if pages_blocked == pages_attempted:
        stats["status"] = "blocked"
    elif pages_blocked > 0:
        stats["status"] = "partial"
    else:
        stats["status"] = "ok"

    # Save to DB (redundant final pass; kept as in your original)
    if save_to_db and HAS_DB and all_cards:
        saved = 0
        for card_dict in all_cards:
            try:
                normalized = normalize_listing(card_dict)
                if normalized:
                    result = upsert_listing(normalized)
                    if result:
                        saved += 1
            except Exception:
                pass
        print(f"\n💾 [{portal.upper()}] Saved {saved}/{len(all_cards)} cards to DB")

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Scan Campinas V2 - Listing Only",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python -m jobs.scan_campinas_v2 --pages 10
    python -m jobs.scan_campinas_v2 --pages 5 --portals vivareal,zap
    python -m jobs.scan_campinas_v2 --pages 10 --portals imovelweb --no-db
        """
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=DEFAULT_PAGES,
        help=f"Pages per portal (default: {DEFAULT_PAGES})"
    )
    parser.add_argument(
        "--portals",
        type=str,
        default=None,
        help=f"Comma-separated portals (default: {','.join(DEFAULT_PORTALS)})"
    )
    parser.add_argument(
        "--city",
        type=str,
        default=DEFAULT_CITY,
        help=f"City to scan (default: {DEFAULT_CITY})"
    )
    parser.add_argument(
        "--state",
        type=str,
        default=DEFAULT_STATE,
        help=f"State abbreviation (default: {DEFAULT_STATE})"
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Skip saving to database"
    )
    parser.add_argument(
        "--visible",
        action="store_true",
        help="Run browser in visible mode (non-headless) - helps bypass Cloudflare"
    )

    args = parser.parse_args()

    portals = args.portals.split(",") if args.portals else None
    save_to_db = not args.no_db
    headless = not args.visible

    exit_code = asyncio.run(run_scan_v2(
        city=args.city,
        state=args.state,
        portals=portals,
        max_pages=args.pages,
        save_to_db=save_to_db,
        headless=headless,
    ))

    sys.exit(exit_code)


if __name__ == "__main__":
    main()

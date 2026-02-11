"""
Zap Imóveis Listing-Only Scraper (V2)

Collects data ONLY from listing pages. Does NOT:
- Enter detail pages
- Extract published_at dates
- Use WAF bypass techniques

Focuses on: robustness, observability, rate limiting.
"""
import re
import json
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from bs4.element import NavigableString

from app.models.offer import OfferCard, Specs, Location

logger = logging.getLogger(__name__)


class ZapListingOnlyScraper:
    """
    Zap Imóveis scraper for listing pages only (V2).
    No detail fetching, no published_at extraction.
    """
    
    PORTAL_NAME = "zap"
    BASE_URL = "https://www.zapimoveis.com.br"
    
    # Block detection patterns
    BLOCK_PATTERNS = [
        "Just a moment",
        "Attention Required",
        "Access Denied",
        "Cloudflare",
        "captcha",
        "cf-browser-verification",
    ]
    
    # Success indicators
    SUCCESS_INDICATORS = [
        "listing-card",
        "olx-core-surface",
        "listing-card__container",
    ]
    
    def __init__(self):
        self.stats = {
            "pages_attempted": 0,
            "pages_ok": 0,
            "pages_blocked": 0,
            "total_cards_found": 0,
            "total_cards_parsed": 0,
            "field_coverage": {},
            "failure_reasons": {},
        }
    
    # -------------------------
    # URL Building
    # -------------------------
    def build_url(self, city: str, state: str, page: int = 1, **filters) -> str:
        """
        Build Zap listing URL with pagination.
        Uses MOST_RECENT ordering.
        """
        city_slug = self._slugify(city)
        state_slug = self._slugify(state)
        
        # Zap uses sp+campinas format
        location_part = f"{state_slug}+{city_slug}"
        
        base = f"{self.BASE_URL}/venda/imoveis/{location_part}/"
        
        params = [
            "transacao=venda",
            f"onde=%2C{state.title()}%2C{city.title()}%2C%2C%2C%2C%2Ccity",
            "ordem=MOST_RECENT",
        ]
        
        if page > 1:
            params.append(f"pagina={page}")
        
        return f"{base}?{'&'.join(params)}"
    
    def _slugify(self, text: str) -> str:
        """Convert text to URL slug."""
        import unicodedata
        if not text:
            return ""
        text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('utf-8')
        return text.lower().replace(" ", "-")
    
    # -------------------------
    # Block Detection
    # -------------------------
    def is_blocked(self, html: str) -> bool:
        """
        Detect if response is blocked by WAF/Cloudflare.
        Prioritizes success indicators over block patterns.
        """
        if not html:
            return True
        
        # Check success indicators first
        for indicator in self.SUCCESS_INDICATORS:
            if indicator in html:
                return False
        
        # Check for valid app shell (Next.js/React page)
        valid_app_indicators = [
            "__NEXT_DATA__",
            "gtm.start",
            "_next/static",
            "zapimoveis.com.br",
            "listing-card",
            "listing-results",
        ]
        for indicator in valid_app_indicators:
            if indicator in html:
                return False
        
        # Check block patterns
        html_lower = html.lower()
        for pattern in self.BLOCK_PATTERNS:
            if pattern.lower() in html_lower:
                return True
        
        # Check title
        try:
            soup = BeautifulSoup(html, "html.parser")
            title = soup.title.string.strip() if soup.title else ""
            title_lower = title.lower()
            if any(p in title_lower for p in ["just a moment", "access denied", "attention required"]):
                return True
        except:
            pass
        
        return False
    
    def content_has_cards(self, html: str) -> bool:
        """Check if HTML has card content to parse."""
        if not html:
            return False
        for indicator in self.SUCCESS_INDICATORS:
            if indicator in html:
                return True
        return False
    
    def get_block_reason(self, html: str, status_code: int = 200) -> Optional[str]:
        """Get specific block reason for logging."""
        if status_code == 403:
            return "http_403"
        if status_code == 429:
            return "http_429"
        if not html:
            return "empty_response"
        
        html_lower = html.lower()
        if "captcha" in html_lower:
            return "captcha"
        if "cloudflare" in html_lower:
            return "cloudflare"
        if "just a moment" in html_lower:
            return "cloudflare_challenge"
        
        return "unknown_block"
    
    # -------------------------
    # Parsing
    # -------------------------
    def parse_cards(self, html: str) -> List[Dict[str, Any]]:
        """
        Parse listing cards from HTML.
        published_at is ALWAYS None (V2 rule).
        """
        if not html:
            self.stats["failure_reasons"]["empty_html"] = \
                self.stats["failure_reasons"].get("empty_html", 0) + 1
            return []
        
        soup = BeautifulSoup(html, "html.parser")
        
        # Try to extract NEXT_DATA
        next_data_map = self._extract_next_data(soup)
        
        # Find card containers
        containers = soup.select(
            'div[data-testid="listing-card"], '
            'a.olx-core-surface, '
            '.listing-card__container'
        )
        
        if not containers:
            if self.is_blocked(html):
                self.stats["failure_reasons"]["blocked_listing"] = \
                    self.stats["failure_reasons"].get("blocked_listing", 0) + 1
            else:
                self.stats["failure_reasons"]["no_cards_selector"] = \
                    self.stats["failure_reasons"].get("no_cards_selector", 0) + 1
            return []
        
        self.stats["total_cards_found"] += len(containers)
        
        cards = []
        for container in containers:
            try:
                card = self._parse_single_card(container, next_data_map)
                if card and card.get("url"):
                    cards.append(card)
                    self.stats["total_cards_parsed"] += 1
            except Exception as e:
                self.stats["failure_reasons"]["parse_exception"] = \
                    self.stats["failure_reasons"].get("parse_exception", 0) + 1
                logger.debug(f"Card parse error: {e}")
        
        return cards
    
    def _parse_single_card(self, container, next_data_map: Dict) -> Optional[Dict[str, Any]]:
        """Parse a single card container."""
        # 1. URL
        a = (
            container.select_one('a[href*="/imovel/"]') or 
            container.select_one('a[href^="/imovel/"]') or
            (container if container.name == "a" else None) or
            container.select_one("a[href]")
        )
        href = a.get("href") if a else None
        if not href:
            return None
        
        url = self._to_absolute(href)
        if "/imovel/" not in url:
            return None
        
        # External ID
        external_id = None
        ext_id_match = re.search(r"-id-(\d+)", url)
        if ext_id_match:
            external_id = ext_id_match.group(1)
        
        # 2. Title
        title = None
        title_node = container.select_one("h2, .listing-card__title")
        if title_node:
            span = title_node.select_one("span")
            if span:
                title = span.get_text(" ", strip=True)
            else:
                title = title_node.get_text(" ", strip=True)
        
        # 3. Location
        neighborhood = None
        city = None
        state = None
        
        # Try NEXT_DATA
        if external_id and external_id in next_data_map:
            nd = next_data_map[external_id]
            neighborhood = nd.get("neighborhood")
        
        # Fallback: listing text
        loc_text = None
        addr_node = container.select_one(
            '[data-testid*="address"], [data-testid*="location"], '
            '[class*="address"], [class*="location"]'
        )
        if addr_node:
            loc_text = addr_node.get_text(" ", strip=True)
        
        # Title siblings
        if not loc_text and title_node:
            span = title_node.select_one("span")
            if span:
                for sib in span.next_siblings:
                    if isinstance(sib, NavigableString):
                        t = str(sib).strip()
                    else:
                        t = sib.get_text(" ", strip=True)
                    if t:
                        loc_text = t
                        break
        
        if loc_text:
            parsed_loc = self._parse_location_text(loc_text)
            if not neighborhood:
                neighborhood = parsed_loc.get("neighborhood")
            if not city:
                city = parsed_loc.get("city")
            if not state:
                state = parsed_loc.get("state")
        
        # URL fallback
        url_city, url_state = self._parse_city_state_from_url(url)
        if not city:
            city = url_city
        if not state:
            state = url_state
        
        # 4. Price
        price = None
        price_node = container.select_one(
            '[data-testid*="price"], [class*="price"]'
        )
        if price_node:
            price = self._parse_price(price_node.get_text(" ", strip=True))
        
        # 5. Specs
        area_m2 = None
        bedrooms = None
        bathrooms = None
        parking = None
        
        # Try spec containers
        spec_nodes = container.select('[data-testid*="feature"], [class*="feature"], li')
        for node in spec_nodes:
            text = node.get_text(" ", strip=True).lower()
            m = re.search(r"(\d+)", text)
            if m:
                val = int(m.group(1))
                if "m²" in text or "area" in text:
                    area_m2 = val
                elif "quarto" in text or "dorm" in text:
                    bedrooms = val
                elif "banheir" in text:
                    bathrooms = val
                elif "vaga" in text or "garag" in text:
                    parking = val
        
        # Costs (Condo/IPTU)
        condo_fee = None
        iptu = None
        
        # Check text content for costs
        # Zap format: Cond. R$ 500
        text = container.get_text(" ", strip=True).lower()
        
        m_condo = re.search(r"cond\.?\s*r\$?\s*([\d\.]+)", text)
        if m_condo:
            condo_fee = float(m_condo.group(1).replace(".", ""))
        
        m_iptu = re.search(r"iptu\s*r\$?\s*([\d\.]+)", text)
        if m_iptu:
            iptu = float(m_iptu.group(1).replace(".", ""))
        
        # 6. Image
        main_image_url = None
        img = container.select_one("img")
        if img:
            main_image_url = (
                img.get("src") or 
                img.get("data-src") or 
                (img.get("srcset") or "").split(",")[0].strip().split(" ")[0]
            )
        
        # 7. Advertiser
        advertiser = None
        if external_id and external_id in next_data_map:
            advertiser = next_data_map[external_id].get("agency_name")
        
        # 8. Property type
        property_type = self._infer_property_type(title)
        
        now = datetime.now(timezone.utc).isoformat()
        
        return {
            "external_id": external_id,
            "portal": self.PORTAL_NAME,
            "url": url,
            "title": title,
            "price": price,
            "condo_fee": condo_fee,
            "iptu": iptu,
            "area_m2": area_m2,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "parking": parking,
            "property_type": property_type,
            "street": None,
            "neighborhood": neighborhood,
            "city": city,
            "state": state,
            "latitude": None,
            "longitude": None,
            "main_image_url": main_image_url,
            "images": [main_image_url] if main_image_url else [],
            "advertiser": advertiser,
            "published_at": None,  # NEVER extracted in V2
            "first_seen_at": now,
            "last_seen_at": now,
        }
    
    def _extract_next_data(self, soup: BeautifulSoup) -> Dict[str, Dict]:
        """Extract data from __NEXT_DATA__ script tag."""
        result = {}
        try:
            script = soup.find("script", {"id": "__NEXT_DATA__"})
            if not script:
                return result
            
            data = json.loads(script.string)
            
            def find_listings(obj):
                if isinstance(obj, dict):
                    if "listing" in obj and isinstance(obj.get("listing"), dict):
                        listing = obj["listing"]
                        lid = str(listing.get("id", ""))
                        if lid:
                            result[lid] = {
                                "neighborhood": listing.get("address", {}).get("neighborhood"),
                                "agency_name": listing.get("advertiser", {}).get("name"),
                            }
                    for v in obj.values():
                        find_listings(v)
                elif isinstance(obj, list):
                    for item in obj:
                        find_listings(item)
            
            find_listings(data)
        except Exception as e:
            logger.debug(f"NEXT_DATA extraction failed: {e}")
        
        return result
    
    def _parse_price(self, text: str) -> Optional[float]:
        """Parse price from text."""
        if not text:
            return None
        nums = re.sub(r"[^\d]", "", text)
        if nums:
            return float(nums)
        return None
    
    def _parse_location_text(self, text: str) -> Dict[str, str]:
        """Parse location from listing text."""
        result = {}
        if not text:
            return result
        
        m = re.match(r"(.+?),\s*(.+?)\s*[-–]\s*([A-Z]{2})", text)
        if m:
            result["neighborhood"] = m.group(1).strip()
            result["city"] = m.group(2).strip()
            result["state"] = m.group(3).strip()
            return result
        
        m = re.match(r"(.+?),\s*(.+)", text)
        if m:
            result["neighborhood"] = m.group(1).strip()
            result["city"] = m.group(2).strip()
            return result
        
        result["neighborhood"] = text.strip()
        return result
    
    def _parse_city_state_from_url(self, url: str) -> tuple:
        """Parse city and state from Zap URL."""
        # Pattern: /venda/imoveis/sp+campinas/...
        m = re.search(r"/([a-z]{2})\+([a-z-]+)/", url.lower())
        if m:
            state = m.group(1).upper()
            city = m.group(2).replace("-", " ").replace("+", " ").title()
            return city, state
        return None, None
    
    def _infer_property_type(self, title: str) -> Optional[str]:
        """Infer property type from title."""
        if not title:
            return None
        title_lower = title.lower()
        if "apartamento" in title_lower:
            return "apartment"
        if "casa" in title_lower:
            return "house"
        if "terreno" in title_lower:
            return "land"
        return None
    
    def _to_absolute(self, url: str) -> str:
        """Convert relative URL to absolute."""
        if not url:
            return ""
        if url.startswith("http"):
            return url
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("/"):
            return self.BASE_URL + url
        return self.BASE_URL + "/" + url
    
    # -------------------------
    # Stats
    # -------------------------
    def calculate_field_coverage(self, cards: List[Dict]) -> Dict[str, float]:
        """Calculate field coverage percentages."""
        if not cards:
            return {}
        
        fields = [
            "external_id", "url", "title", "price", "area_m2", 
            "bedrooms", "bathrooms", "parking", "neighborhood", 
            "city", "state", "main_image_url", "advertiser"
        ]
        
        coverage = {}
        for field in fields:
            filled = sum(1 for c in cards if c.get(field) is not None)
            coverage[field] = round(filled / len(cards) * 100, 1)
        
        self.stats["field_coverage"] = coverage
        return coverage
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current statistics."""
        success_rate = 0.0
        if self.stats["total_cards_found"] > 0:
            success_rate = self.stats["total_cards_parsed"] / self.stats["total_cards_found"] * 100
        
        return {
            **self.stats,
            "success_rate": round(success_rate, 1),
        }
    
    def reset_stats(self):
        """Reset statistics for new run."""
        self.stats = {
            "pages_attempted": 0,
            "pages_ok": 0,
            "pages_blocked": 0,
            "total_cards_found": 0,
            "total_cards_parsed": 0,
            "field_coverage": {},
            "failure_reasons": {},
        }

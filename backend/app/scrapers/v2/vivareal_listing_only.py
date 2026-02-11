"""
VivaReal Listing-Only Scraper (V2)

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


class VivaRealListingOnlyScraper:
    """
    VivaReal scraper for listing pages only (V2).
    No detail fetching, no published_at extraction.
    """
    
    PORTAL_NAME = "vivareal"
    BASE_URL = "https://www.vivareal.com.br"
    
    # Block detection patterns
    BLOCK_PATTERNS = [
        "Just a moment",
        "Attention Required",
        "Access Denied",
        "Cloudflare",
        "captcha",
        "cf-browser-verification",
    ]
    
    # Success indicators (if present, likely not blocked)
    # Updated for new VivaReal HTML structure (OLX-based)
    SUCCESS_INDICATORS = [
        "olx-core-surface",
        "listings-wrapper",
        "Card-module-scss-module",
        "property-card__container",  # fallback
        "rp-property-cd",             # fallback
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
        Build VivaReal listing URL with pagination.
        Uses MOST_RECENT ordering.
        """
        city_slug = self._slugify(city)
        state_slug = self._slugify(state)
        
        # Base URL with proper encoding
        base = f"{self.BASE_URL}/venda/{state_slug}/{city_slug}/"
        
        # Query params for most recent ordering
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
        Returns True if blocked, False if OK.
        
        IMPORTANT: We prioritize success indicators over block patterns
        to avoid false positives from CDN references in valid pages.
        """
        if not html:
            return True
        
        # Check success indicators first (if ANY are present, not blocked)
        for indicator in self.SUCCESS_INDICATORS:
            if indicator in html:
                return False
        
        # Check for valid app shell (Next.js/React page even if not fully rendered)
        # These indicate a real page was loaded, not a Cloudflare block page
        valid_app_indicators = [
            "__NEXT_DATA__",
            "gtm.start",
            "_next/static",
            "vivareal.com.br",
            "property-card",
            "listing-results",
        ]
        for indicator in valid_app_indicators:
            if indicator in html:
                # Has valid content - not a block page
                # But cards might not have rendered yet
                return False
        
        # Page is likely blocked - check block patterns
        html_lower = html.lower()
        for pattern in self.BLOCK_PATTERNS:
            if pattern.lower() in html_lower:
                return True
        
        # Check title for block indicators
        try:
            soup = BeautifulSoup(html, "html.parser")
            title = soup.title.string.strip() if soup.title else ""
            title_lower = title.lower()
            if any(p.lower() in title_lower for p in ["just a moment", "access denied", "attention required"]):
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
        if "access denied" in html_lower:
            return "access_denied"
        
        return "unknown_block"
    
    # -------------------------
    # Parsing
    # -------------------------
    def parse_cards(self, html: str) -> List[Dict[str, Any]]:
        """
        Parse listing cards from HTML.
        Returns list of card dicts with all available fields.
        published_at is ALWAYS None (V2 rule).
        """
        if not html:
            self.stats["failure_reasons"]["empty_html"] = \
                self.stats["failure_reasons"].get("empty_html", 0) + 1
            return []
        
        soup = BeautifulSoup(html, "html.parser")
        
        # Try to extract NEXT_DATA JSON for additional data
        next_data_map = self._extract_next_data(soup)
        
        # NEW VIVAREAL STRUCTURE: The card is the <a> tag itself
        # Primary selector: anchor tags with /imovel/ in href
        containers = soup.select('a[href*="/imovel/"]')
        
        # Fallback to old selectors if primary fails
        if not containers:
            containers = soup.select(
                '.property-card__container a[href*="/imovel/"], '
                'li[data-cy="rp-property-cd"] a[href*="/imovel/"]'
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
        
        # Deduplicate by URL since same link may appear multiple times
        seen_urls = set()
        cards = []
        
        for container in containers:
            try:
                card = self._parse_single_card(container, next_data_map)
                if card and card.get("url"):
                    url = card["url"]
                    if url not in seen_urls:
                        seen_urls.add(url)
                        cards.append(card)
                        self.stats["total_cards_parsed"] += 1
            except Exception as e:
                self.stats["failure_reasons"]["parse_exception"] = \
                    self.stats["failure_reasons"].get("parse_exception", 0) + 1
                logger.debug(f"Card parse error: {e}")
        
        return cards
    
    def _parse_single_card(self, container, next_data_map: Dict) -> Optional[Dict[str, Any]]:
        """
        Parse a single card container.
        In new VivaReal structure, the container IS the <a> tag.
        """
        # 1. URL - container itself may be the link
        if container.name == "a":
            href = container.get("href")
        else:
            a = container.select_one('a[href*="/imovel/"]') or container.select_one("a[href]")
            href = a.get("href") if a else None
        
        if not href or "/imovel/" not in href:
            return None
        
        url = self._to_absolute(href)
        
        # Extract external ID from URL
        external_id = None
        ext_id_match = re.search(r"-id-(\d+)", url)
        if ext_id_match:
            external_id = ext_id_match.group(1)
        
        # 2. Title - from img alt or from URL slug
        title = None
        img = container.select_one("img")
        if img and img.get("alt"):
            title = img.get("alt")
        
        # Fallback: extract title from URL
        if not title:
            # URL like: .../apartamento-2-quartos-tijuca-zona-norte-rio-de-janeiro-64m2-aluguel-RS1780-id-2849319429/
            url_parts = url.split("/")
            imovel_idx = -1
            for i, part in enumerate(url_parts):
                if part == "imovel":
                    imovel_idx = i
                    break
            if imovel_idx >= 0 and imovel_idx + 1 < len(url_parts):
                slug = url_parts[imovel_idx + 1]
                # Clean up slug to title
                title = slug.replace("-", " ").title()
                # Truncate at price/id
                for marker in [" Rs", " Id ", " Aluguel", " Venda"]:
                    if marker.lower() in title.lower():
                        idx = title.lower().find(marker.lower())
                        title = title[:idx].strip()
                        break
        
        # 3. Location - parse from URL
        neighborhood = None
        city = None
        state = None
        
        # Try to parse from URL: /imovel/tipo-quartos-bairro-zona-cidade-...
        url_city, url_state = self._parse_city_state_from_url(url)
        city = url_city
        state = url_state
        
        # Try to get neighborhood from URL slug
        neighborhood = self._extract_neighborhood_from_url(url)
        
        # Try NEXT_DATA
        if external_id and external_id in next_data_map:
            nd = next_data_map[external_id]
            if nd.get("neighborhood"):
                neighborhood = nd["neighborhood"]
        
        # 4. Price - parse from URL if present
        price = None
        price_match = re.search(r"-RS?(\d+)-", url, re.IGNORECASE)
        if price_match:
            price = float(price_match.group(1))
        
        # 5. Specs & Costs (Condo/IPTU)
        area_m2 = None
        bedrooms = None
        bathrooms = None
        parking = None
        condo_fee = None
        iptu = None
        
        # Try to extract from URL: tipo-N-quartos-area-...
        bedrooms_match = re.search(r"(\d+)-quartos?", url.lower())
        if bedrooms_match:
            bedrooms = int(bedrooms_match.group(1))
        
        area_match = re.search(r"-(\d+)m2?-", url.lower())
        if area_match:
            area_m2 = int(area_match.group(1))
        
        # Check text content for everything
        text = container.get_text(" ", strip=True).lower()
        
        # Specs regex fallback
        if not area_m2:
            m = re.search(r"(\d+)\s*m²", text)
            if m: area_m2 = int(m.group(1))
        if not bedrooms:
            m = re.search(r"(\d+)\s*quarto", text)
            if m: bedrooms = int(m.group(1))
        if not bathrooms:
            m = re.search(r"(\d+)\s*banheiro", text)
            if m: bathrooms = int(m.group(1))
        if not parking:
            m = re.search(r"(\d+)\s*vaga", text)
            if m: parking = int(m.group(1))
            
        # Costs regex
        # Condomínio: R$ 500
        m_condo = re.search(r"condominio:?\s*r\$?\s*([\d\.]+)", text.replace("condomínio", "condominio"))
        if m_condo:
            condo_fee = float(m_condo.group(1).replace(".", ""))
            
        # IPTU: R$ 200
        m_iptu = re.search(r"iptu:?\s*r\$?\s*([\d\.]+)", text)
        if m_iptu:
            iptu = float(m_iptu.group(1).replace(".", ""))
        
        # 6. Image
        main_image_url = None
        if img:
            main_image_url = (
                img.get("src") or 
                img.get("data-src") or 
                (img.get("srcset") or "").split(",")[0].strip().split(" ")[0]
            )
        
        # 7. Advertiser (from NEXT_DATA if available)
        advertiser = None
        if external_id and external_id in next_data_map:
            advertiser = next_data_map[external_id].get("agency_name")
        
        # 8. Property type (infer from title or URL)
        property_type = self._infer_property_type(title or url)
        
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
            "latitude": None,   # Not available in listing
            "longitude": None,  # Not available in listing
            "main_image_url": main_image_url,
            "images": [main_image_url] if main_image_url else [],
            "advertiser": advertiser,
            "published_at": None,  # NEVER extracted in V2
            "first_seen_at": now,
            "last_seen_at": now,
        }
    
    def _extract_neighborhood_from_url(self, url: str) -> Optional[str]:
        """Extract neighborhood from VivaReal URL if possible."""
        # URL pattern: /imovel/tipo-quartos-BAIRRO-zona-cidade-area-...
        # Example: apartamento-2-quartos-tijuca-zona-norte-rio-de-janeiro-64m2
        try:
            path = url.split("/imovel/")[-1].split("?")[0]
            parts = path.replace("-", " ").split()
            # Skip common words to find neighborhood
            skip_words = ["apartamento", "casa", "kitnet", "terreno", "comercial", "sala",
                         "quartos", "quarto", "zona", "norte", "sul", "oeste", "leste",
                         "central", "venda", "aluguel", "id"]
            
            # Look for neighborhood after "quartos"
            after_quartos = False
            for word in parts:
                if word.lower() in ["quartos", "quarto"]:
                    after_quartos = True
                    continue
                if after_quartos and word.lower() not in skip_words and len(word) > 2:
                    # Capitalize first letter
                    return word.title()
        except:
            pass
        return None
    
    def _extract_next_data(self, soup: BeautifulSoup) -> Dict[str, Dict]:
        """Extract data from __NEXT_DATA__ script tag."""
        result = {}
        try:
            script = soup.find("script", {"id": "__NEXT_DATA__"})
            if not script:
                return result
            
            data = json.loads(script.string)
            
            # Navigate to listings
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
    
    def _extract_spec(self, container, selector: str) -> Optional[int]:
        """Extract numeric spec from container."""
        node = container.select_one(selector)
        if node:
            m = re.search(r"(\d+)", node.get_text(" ", strip=True))
            if m:
                return int(m.group(1))
        return None
    
    def _parse_price(self, text: str) -> Optional[float]:
        """Parse price from text."""
        if not text:
            return None
        nums = re.sub(r"[^\d]", "", text)
        if nums:
            return float(nums)
        return None
    
    def _parse_location_text(self, text: str) -> Dict[str, str]:
        """Parse location from listing text like 'Centro, Campinas - SP'."""
        result = {}
        if not text:
            return result
        
        # Pattern: "Neighborhood, City - State" or "Neighborhood - City"
        # Try "Bairro, Cidade - UF"
        m = re.match(r"(.+?),\s*(.+?)\s*[-–]\s*([A-Z]{2})", text)
        if m:
            result["neighborhood"] = m.group(1).strip()
            result["city"] = m.group(2).strip()
            result["state"] = m.group(3).strip()
            return result
        
        # Try "Bairro, Cidade"
        m = re.match(r"(.+?),\s*(.+)", text)
        if m:
            result["neighborhood"] = m.group(1).strip()
            result["city"] = m.group(2).strip()
            return result
        
        # Single value = neighborhood
        result["neighborhood"] = text.strip()
        return result
    
    def _parse_city_state_from_url(self, url: str) -> tuple:
        """Parse city and state from VivaReal URL."""
        # Pattern: /venda/sp/campinas/...
        m = re.search(r"/venda/([a-z]{2})/([a-z-]+)/", url.lower())
        if m:
            state = m.group(1).upper()
            city = m.group(2).replace("-", " ").title()
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
        if "comercial" in title_lower or "sala" in title_lower:
            return "commercial"
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
    # Stats / Coverage
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

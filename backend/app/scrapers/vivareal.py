import unicodedata
import re
import json
import logging
import random
import asyncio
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta

from bs4 import BeautifulSoup
from bs4.element import NavigableString
# Importação necessária para o bypass de JA3
from curl_cffi import requests as cur_requests

from app.scrapers.base import PortalScraper
from app.models.offer import OfferCard, Specs, Location
from app.utils.parsers import parse_ptbr_recency

logger = logging.getLogger(__name__)


class VivaRealScraper(PortalScraper):
    BASE_URL = "https://www.vivareal.com.br"

    def __init__(self):
        super().__init__()
        self.stats = {
            "total_links": 0,
            "date_found_list": 0,
            "date_found_detail_json": 0,
            "date_found_detail_text": 0,
            "date_found_detail_regex": 0,
            "date_missing": 0,
            "final_under_7_days": 0,
            "failure_reasons": {},
            "detail_fetch_fail": 0,
            "detail_blocked": 0,
            "location_found_detail": 0,
            "location_fallback_list": 0,
        }

    # -------------------------
    # Utils
    # -------------------------
    def print_stats(self):
        print("\n📊 [VIVAREAL] RELATÓRIO FINAL DE EXTRAÇÃO")
        for k, v in self.stats.items():
            if k != "failure_reasons":
                print(f"{k}: {v}")
        if self.stats["failure_reasons"]:
            print("Principais motivos de falha:")
            for reason, count in self.stats["failure_reasons"].items():
                print(f"  - {reason}: {count}")
        print("------------------------------------------\n")

    def slugify(self, text: str) -> str:
        if not text:
            return ""
        text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
        text = re.sub(r"[^\w\s-]", "", text).strip().lower()
        return re.sub(r"[-\s]+", "-", text)

    @staticmethod
    def normalize_url(url: str) -> str:
        """Remove querystring e trailing slash pra dedupe."""
        if not url:
            return ""
        u = url.split("?")[0].rstrip("/")
        return u

    @staticmethod
    def to_absolute(url: str) -> str:
        if not url:
            return ""
        if url.startswith("http"):
            return url
        if url.startswith("/"):
            return VivaRealScraper.BASE_URL + url
        return VivaRealScraper.BASE_URL + "/" + url

    # -------------------------
    # Location parsing
    # -------------------------
    @staticmethod
    def normalize_dashes(s: str) -> str:
        return re.sub(r"\s*[—–-]\s*", " – ", (s or "").strip())

    @classmethod
    def extract_location_parts_from_address(cls, address: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        if not address:
            return (None, None, None, None)

        s = cls.normalize_dashes(address)
        uf = None
        m_uf = re.search(r"\s+–\s*([A-Za-z]{2})$", s)
        if m_uf:
            uf = m_uf.group(1).upper()
            s = s[: m_uf.start()].strip()

        street, bairro, cidade = None, None, None

        if " – " in s:
            left, right = s.split(" – ", 1)
            street = left.strip() or None
            if "," in right:
                p1, p2 = [x.strip() for x in right.split(",", 1)]
                bairro, cidade = p1 or None, p2 or None
            else:
                bairro = right.strip() or None
            return (street, bairro, cidade, uf)

        if "," in s:
            parts = [p.strip() for p in s.split(",") if p.strip()]
            if len(parts) == 2:
                bairro, cidade = parts[0], parts[1]
            elif len(parts) >= 3:
                cidade = parts[-1]
                bairro = parts[-2]
                street = ", ".join(parts[:-2]).strip() or None
            return (street, bairro, cidade, uf)

        bairro = s.strip() or None
        return (street, bairro, cidade, uf)

    @staticmethod
    def extract_location_parts_from_listing_text(text: str) -> Tuple[Optional[str], Optional[str]]:
        if not text:
            return (None, None)
        s = text.strip()
        if "," not in s:
            return (s if s else None, None)
        p1, p2 = [x.strip() for x in s.split(",", 1)]
        return (p1 or None, p2 or None)

    @classmethod
    def extract_bairro_from_address(cls, address: str) -> Optional[str]:
        _, bairro, _, _ = cls.extract_location_parts_from_address(address)
        return bairro

    def calculate_days_ago(self, date_input: str) -> Optional[int]:
        if not date_input:
            return None
        try:
            clean_date = date_input.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_date)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            delta = now - dt
            return max(0, delta.days)
        except Exception:
            pass
        try:
            return parse_ptbr_recency(date_input)
        except Exception:
            return None

    @staticmethod
    def parse_city_state_from_url(url: str) -> Tuple[str, str]:
        if not url:
            return ("Campinas", "SP")
        u = url.lower()
        m = re.search(r"/(ac|al|am|ap|ba|ce|df|es|go|ma|mg|ms|mt|pa|pb|pe|pi|pr|rj|rn|ro|rr|rs|sc|se|sp|to)/([a-z0-9-]+)/", u)
        if m:
            st = m.group(1).upper()
            city = m.group(2).replace("-", " ").strip().title()
            return (city, st)
        states = "ac|al|am|ap|ba|ce|df|es|go|ma|mg|ms|mt|pa|pb|pe|pi|pr|rj|rn|ro|rr|rs|sc|se|sp|to"
        m2 = re.search(rf"-([a-z0-9-]+)-({states})(?:-|$|/)", u)
        if m2:
            city_cand = m2.group(1).replace("-", " ").strip()
            if len(city_cand) < 40 and "venda" not in city_cand:
                 return (city_cand.title(), m2.group(2).upper())
        return ("Campinas", "SP")

    @staticmethod
    def parse_price_to_number(price_text: str) -> Optional[float]:
        if not price_text:
            return None
        m = re.search(r"R\$\s*([\d\.\,]+)", price_text)
        if not m: m = re.search(r"([\d\.\,]+)", price_text)
        if not m: return None
        raw = m.group(1).replace(".", "").replace(",", ".")
        try:
            return float(raw)
        except Exception:
            return None

    def build_url(self, city: str, state: str, filters: dict, page: int) -> str:
        operation = "venda" if filters.get("operation") == "sale" else "aluguel"
        ptype = filters.get("property_type")
        if ptype == "apartment": ptype = "apartamento_residencial"
        elif ptype == "house": ptype = "casa_residencial"
        else: ptype = "apartamento_residencial"

        city_slug, state_slug = self.slugify(city), self.slugify(state)
        neighborhood = self.slugify(filters.get("query", ""))
        beds_min = filters.get("bedrooms_min")

        path_suffix = f"{beds_min}-quartos/" if beds_min else ""
        if neighborhood:
            url = f"{self.BASE_URL}/{operation}/{state_slug}/{city_slug}/bairros/{neighborhood}/{ptype}/{path_suffix}"
        else:
            url = f"{self.BASE_URL}/{operation}/{state_slug}/{city_slug}/{ptype}/{path_suffix}"

        params = [f"transacao={operation}", f"tipos={ptype}"]
        price_min, price_max = filters.get("price_min"), filters.get("price_max")
        if price_min: params.append(f"precoMinimo={price_min}")
        if price_max: params.append(f"precoMaximo={price_max}")
        if beds_min:
            beds_list = [str(i) for i in range(int(beds_min), int(beds_min) + 3)]
            params.append(f"quartos={','.join(beds_list)}")

        url += f"?{'&'.join(params)}"
        if page > 1: url += f"&pagina={page}"
        return url

    def _extract_next_data(self, soup: BeautifulSoup) -> Dict[str, Dict[str, Any]]:
        data_map = {}
        try:
            script = soup.find("script", {"id": "__NEXT_DATA__"})
            if not script: return {}
            json_blob = json.loads(script.string)
            
            def find_listings(obj):
                if isinstance(obj, dict):
                    if "listing" in obj and "link" in obj:
                        l = obj["listing"]
                        ext_id = l.get("externalId") or l.get("id")
                        if ext_id:
                            dt = l.get("createdAt") or l.get("updatedAt") or l.get("publicationDate")
                            pub_at = None
                            if dt:
                                try: pub_at = datetime.fromisoformat(dt.replace("Z", "+00:00"))
                                except: pass
                            adv = (l.get("account") or l.get("advertiser") or {}).get("name")
                            bairro = (l.get("address") or {}).get("neighborhood")
                            data_map[str(ext_id)] = {"published_at": pub_at, "agency_name": adv, "neighborhood": bairro}
                    for k, v in obj.items(): find_listings(v)
                elif isinstance(obj, list):
                    for item in obj: find_listings(item)
            find_listings(json_blob)
        except Exception: pass
        return data_map

    def parse_cards(self, html: str, recency_days: int) -> List[OfferCard]:
        soup = BeautifulSoup(html or "", "html.parser")
        next_data_map = self._extract_next_data(soup)
        containers = soup.select('li[data-cy="rp-property-cd"], .property-card__container, [data-testid="listing-card"]')

        if not containers:
            reason = "blocked_listing" if self.is_blocked(html) else "no_cards_listing"
            self.stats["failure_reasons"][reason] = self.stats["failure_reasons"].get(reason, 0) + 1
            return []

        url_map: Dict[str, Dict[str, Any]] = {}
        for container in containers:
            try:
                a = container.select_one('a[href*="/imovel/"]') or container.select_one('a[href^="/imovel/"]') or container.select_one("a[href]")
                href = a.get("href") if a else None
                abs_url = self.to_absolute(href) if href else ""
                norm_url = self.normalize_url(abs_url)
                if not norm_url or "/imovel/" not in norm_url: continue

                if norm_url not in url_map:
                    url_map[norm_url] = {"url": norm_url, "title": None, "price": None, "specs": {}, "image_url": None, "neighborhood_fallback": None, "city_fallback": None, "published_at": None, "agency_name": None}

                ext_id_match = re.search(r"-id-(\d+)", norm_url)
                if ext_id_match:
                    eid = ext_id_match.group(1)
                    if eid in next_data_map:
                        nd = next_data_map[eid]
                        if nd.get("published_at"): url_map[norm_url]["published_at"] = nd["published_at"]
                        if nd.get("agency_name"): url_map[norm_url]["agency_name"] = nd["agency_name"]
                        if nd.get("neighborhood"): url_map[norm_url]["neighborhood_fallback"] = nd["neighborhood"]

                title_node = container.select_one("h2, .property-card__title")
                loc_list_fallback = None
                if title_node:
                    span = title_node.select_one("span")
                    if span:
                        url_map[norm_url]["title"] = url_map[norm_url]["title"] or span.get_text(" ", strip=True)
                        for sib in span.next_siblings:
                            t = (str(sib) if isinstance(sib, NavigableString) else sib.get_text(" ", strip=True)).strip()
                            if t: loc_list_fallback = t; break
                    else:
                        url_map[norm_url]["title"] = url_map[norm_url]["title"] or title_node.get_text(" ", strip=True)

                addr_list_node = container.select_one('[data-testid*="address"], [data-cy*="address"], .property-card__address')
                if addr_list_node:
                    txt = addr_list_node.get_text(" ", strip=True)
                    if txt: loc_list_fallback = txt

                if loc_list_fallback:
                    fb_bairro, fb_cidade = self.extract_location_parts_from_listing_text(loc_list_fallback)
                    if fb_bairro: url_map[norm_url]["neighborhood_fallback"] = url_map[norm_url]["neighborhood_fallback"] or fb_bairro
                    if fb_cidade: url_map[norm_url]["city_fallback"] = url_map[norm_url]["city_fallback"] or fb_cidade

                price_node = container.select_one('[data-cy="rp-cardProperty-price-txt"], .property-card__price')
                if price_node and url_map[norm_url]["price"] is None:
                    p_num = self.parse_price_to_number(price_node.get_text(" ", strip=True))
                    if p_num is not None: url_map[norm_url]["price"] = p_num

                specs = url_map[norm_url]["specs"]
                def grab_int(sel, key):
                    node = container.select_one(sel)
                    if node:
                        m = re.search(r"(\d+)", node.get_text(" ", strip=True))
                        if m: specs[key] = int(m.group(1))
                grab_int('li[data-cy="rp-cardProperty-propertyArea-txt"]', "area")
                grab_int('li[data-cy="rp-cardProperty-bedroomQuantity-txt"]', "bedrooms")
                grab_int('li[data-cy="rp-cardProperty-bathroomQuantity-txt"]', "bathrooms")
                grab_int('li[data-cy="rp-cardProperty-parkingSpacesQuantity-txt"]', "parking")

                if not url_map[norm_url]["image_url"]:
                    img = container.select_one("img")
                    if img:
                        src = img.get("src") or img.get("data-src") or (img.get("srcset") or "").split(",")[0].strip().split(" ")[0]
                        if src: url_map[norm_url]["image_url"] = src
            except Exception as e:
                self.stats["failure_reasons"]["listing_parse_exception"] = self.stats["failure_reasons"].get("listing_parse_exception", 0) + 1

        results = []
        for norm_url, data in url_map.items():
            self.stats["total_links"] += 1
            city, state = self.parse_city_state_from_url(norm_url)
            s_data = data.get("specs") or {}
            specs = Specs(area=s_data.get("area", 0), bedrooms=s_data.get("bedrooms", 0), bathrooms=s_data.get("bathrooms", 0), parking=s_data.get("parking", 0))
            if data.get("neighborhood_fallback"): self.stats["location_fallback_list"] += 1
            if data.get("city_fallback") and (not city or city == "Campinas"): city = data.get("city_fallback")
            
            pub_at = data.get("published_at")
            days_ago = 999
            if pub_at:
                days_ago = max(0, (datetime.now(timezone.utc) - pub_at.replace(tzinfo=timezone.utc)).days)
                self.stats["date_found_list"] += 1
            else: self.stats["date_missing"] += 1

            results.append(OfferCard(portal="vivareal", external_id=norm_url.split("-")[-1].replace("/", ""), title=data.get("title") or "Imóvel VivaReal", url=norm_url, price=data.get("price") or 0, main_image_url=data.get("image_url"), agency_name=data.get("agency_name"), specs=specs, location=Location(city=city, state=state, neighborhood=data.get("neighborhood_fallback") or "", address=None), published_days_ago=days_ago, published_at=pub_at, last_seen=datetime.now()))
        return results

    # -------------------------
    # Enrich with DETAIL pages (MUDANÇA AQUI: BYPASS JA3 + REFERER)
    # -------------------------
    async def enrich_cards_with_details(self, fetcher, cards: List[OfferCard], delay_seconds: float = 1.0) -> List[OfferCard]:
        enriched = []
        # URL da listagem para usar como Referer (melhor esforço)
        search_referer = getattr(self, "last_search_url", self.BASE_URL)

        for idx, card in enumerate(cards, 1):
            detail_url = getattr(card, "url", None)
            if not detail_url:
                enriched.append(card); continue

            # Jitter randômico para mimetismo humano
            await asyncio.sleep(delay_seconds * random.uniform(0.8, 1.5))

            try:
                # BYPASS CLOUDFLARE: Usando curl_cffi para mimetizar Chrome 120 e evitar 403
                # Usamos asyncio.to_thread para não travar o loop de eventos com a chamada síncrona do curl_cffi
                def do_fetch():
                    return cur_requests.get(
                        detail_url,
                        impersonate="chrome120",
                        headers={
                            "Referer": search_referer,
                            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        },
                        timeout=15
                    )
                
                resp = await asyncio.to_thread(do_fetch)
                detail_html = resp.text if resp.status_code == 200 else None
            except Exception:
                detail_html = None

            if not detail_html:
                self.stats["detail_fetch_fail"] += 1
                self.stats["failure_reasons"]["detail_html_empty"] = self.stats["failure_reasons"].get("detail_html_empty", 0) + 1
                enriched.append(card); continue

            if self.is_blocked(detail_html):
                self.stats["detail_blocked"] += 1
                self.stats["failure_reasons"]["detail_blocked"] = self.stats["failure_reasons"].get("detail_blocked", 0) + 1
                enriched.append(card); continue

            soup = BeautifulSoup(detail_html, "html.parser")
            street, bairro, cidade, uf = None, None, None, None
            try:
                addr_node = soup.select_one('[data-testid="location-address"]')
                if addr_node:
                    street, bairro, cidade, uf = self.extract_location_parts_from_address(addr_node.get_text(" ", strip=True))
            except Exception: pass

            details = self.extract_details(detail_html) or {}
            nb_final = bairro or details.get("neighborhood") or getattr(card.location, "neighborhood", "") or ""
            if bairro: self.stats["location_found_detail"] += 1

            city_final = cidade or details.get("city") or getattr(card.location, "city", "Campinas")
            state_final = uf or details.get("state") or getattr(card.location, "state", "SP")
            addr_final = street or getattr(card.location, "address", None)
            adv_final = details.get("advertiser") or getattr(card, "agency_name", None)

            published_at = details.get("published_at") or getattr(card, "published_at", None)
            published_days_ago = getattr(card, "published_days_ago", 999)
            if published_at and isinstance(published_at, datetime):
                dt = published_at.replace(tzinfo=timezone.utc) if published_at.tzinfo is None else published_at.astimezone(timezone.utc)
                published_days_ago = max(0, (datetime.now(timezone.utc) - dt).days)
            elif details.get("date_text"):
                d = self.calculate_days_ago(details.get("date_text"))
                if d is not None:
                    published_days_ago = d
                    published_at = datetime.now(timezone.utc) - timedelta(days=d)

            if published_days_ago == 999: self.stats["date_missing"] += 1

            specs_final = Specs(
                area=getattr(card.specs, "area", 0) or int(details.get("area") or 0),
                bedrooms=getattr(card.specs, "bedrooms", 0) or int(details.get("bedrooms") or 0),
                bathrooms=getattr(card.specs, "bathrooms", 0) or int(details.get("bathrooms") or 0),
                parking=getattr(card.specs, "parking", 0) or int(details.get("parking") or 0)
            )

            enriched.append(self._model_copy_card(card, update={
                "title": getattr(card, "title", None) or details.get("title") or "Imóvel VivaReal",
                "price": getattr(card, "price", 0) or details.get("price") or 0,
                "main_image_url": getattr(card, "main_image_url", None) or details.get("main_image_url"),
                "agency_name": adv_final, "specs": specs_final,
                "location": Location(city=city_final, state=state_final, neighborhood=nb_final, address=addr_final),
                "published_at": published_at, "published_days_ago": published_days_ago, "last_seen": datetime.now()
            }))
        return enriched

    def _model_copy_card(self, card: OfferCard, update: Dict[str, Any]) -> OfferCard:
        if hasattr(card, "model_copy"): return card.model_copy(update=update)
        if hasattr(card, "copy"): return card.copy(update=update)
        for k, v in update.items():
            try: setattr(card, k, v)
            except Exception: pass
        return card

    def extract_total_pages(self, html: str) -> int:
        soup = BeautifulSoup(html or "", "html.parser")
        buttons = soup.select(".olx-core-pagination__button")
        pages = [int(b.get_text(strip=True)) for b in buttons if b.get_text(strip=True).isdigit()]
        return max(pages) if pages else 1

    def is_blocked(self, html: str) -> bool:
        if not html: return True
        if 'property-card__container' in html or 'data-testid="listing-card"' in html or 'rp-property-cd' in html: return False
        soup = BeautifulSoup(html, "html.parser")
        title = soup.title.string.strip() if soup.title else ""
        if "Just a moment" in title or "Access Denied" in title or "Attention Required" in title or "Cloudflare" in title:
             if 'property-card__container' not in html and 'listing-card' not in html: return True
        return False

    def is_incomplete(self, html: str) -> bool:
        return "olx-core-surface" not in (html or "") and "property-card" not in (html or "")

    # -------------------------
    # Detail extraction (MUDANÇA AQUI: SELETOR DE DATA SEGURO)
    # -------------------------
    def extract_details(self, html: str) -> dict:
        soup = BeautifulSoup(html or "", "html.parser")
        details: Dict[str, Any] = {}
        found_date, source_log = None, None
        found_price, found_area, found_bedrooms, found_bathrooms, found_parking = None, None, None, None, None
        found_title, found_image, found_advertiser = None, None, None

        addr_node = soup.select_one('[data-testid="location-address"]')
        if addr_node:
            street, bairro, cidade, uf = self.extract_location_parts_from_address(addr_node.get_text(" ", strip=True))
            if street: details["address"] = street
            if bairro: details["neighborhood"] = bairro
            if cidade: details["city"] = cidade
            if uf: details["state"] = uf

        # NOVO: Seletor específico de data validado para evitar 403 e pegar o texto correto
        date_el = soup.find("p", class_="text-neutral-110 text-1-5 font-secondary")
        if date_el:
            found_date = date_el.get_text(strip=True)
            source_log = "DETAIL_TEXT_SELECTOR"

        # 1) JSON-LD Recursive
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.get_text() or "{}")
                queue = [data]
                while queue:
                    curr = queue.pop(0)
                    if isinstance(curr, dict):
                        for key in ["datePosted", "datePublished", "createdAt", "updatedAt"]:
                            if not found_date and curr.get(key):
                                v = curr.get(key)
                                if isinstance(v, str) and (len(v) > 10 or "T" in v):
                                    found_date, source_log = v, f"DETAIL_JSON ({key})"
                        if found_price is None: found_price = curr.get("price")
                        if found_area is None: found_area = (curr.get("usableAreas") or [None])[0] if isinstance(curr.get("usableAreas"), list) else curr.get("usableAreas")
                        if found_bedrooms is None: found_bedrooms = (curr.get("bedrooms") or [None])[0] if isinstance(curr.get("bedrooms"), list) else curr.get("bedrooms")
                        if found_bathrooms is None: found_bathrooms = (curr.get("bathrooms") or [None])[0] if isinstance(curr.get("bathrooms"), list) else curr.get("bathrooms")
                        if found_parking is None: found_parking = (curr.get("parkingSpaces") or [None])[0] if isinstance(curr.get("parkingSpaces"), list) else curr.get("parkingSpaces")
                        if not found_image and curr.get("images"):
                            img = curr.get("images")[0]
                            found_image = img.get("dangerousSrc", "").replace("{action}", "crop").replace("{width}", "360").replace("{height}", "240") if isinstance(img, dict) else img
                        if not found_title: found_title = curr.get("title") or curr.get("pageTitle")
                        if not found_advertiser:
                            adv = curr.get("advertiser") or curr.get("account") or curr.get("publisher")
                            found_advertiser = adv.get("name") if isinstance(adv, dict) else adv
                        for v in curr.values():
                            if isinstance(v, (dict, list)): queue.append(v)
                    elif isinstance(curr, list):
                        for item in curr:
                            if isinstance(item, (dict, list)): queue.append(item)
                if found_date and found_advertiser: break
            except Exception: continue

        # 2) Raw Script Regex fallback
        if not found_date:
            for script in soup.find_all("script"):
                content = script.get_text() or ""
                for key in ["datePosted", "datePublished", "createdAt", "updatedAt"]:
                    m = re.search(rf'"{key}"\s*:\s*"(?P<date>[^"]+)"', content)
                    if m and (len(m.group("date")) > 10 or "T" in m.group("date")):
                        found_date, source_log = m.group("date"), f"DETAIL_SCRIPT_REGEX ({key})"; break
                if found_date: break

        # 3) Text fallback
        if not found_date:
            text = (soup.select_one("main") or soup.body or soup).get_text(" ", strip=True)
            m1 = re.search(r"(Anúncio criado em\s+.*?)(?:,|$)", text, re.I)
            if m1: found_date, source_log = m1.group(1).strip(), "DETAIL_TEXT_CREATED"
            else:
                m2 = re.search(r"criado em\s+(.{0,40})", text, re.I)
                if m2: found_date, source_log = "criado em " + m2.group(1).strip(), "DETAIL_TEXT_GENERIC"

        # Fallbacks finais para outros campos
        if not found_advertiser:
            adv_node = soup.select_one('[data-testid="advertiser-info-header"] a, .carousel-advertiser-info__account p, [data-cy="rp-advertiser-name"], .advertiser-info__name')
            if adv_node: found_advertiser = adv_node.get_text(" ", strip=True)
        if not found_title:
            t_tag = soup.select_one("h1, title")
            if t_tag: found_title = t_tag.get_text(" ", strip=True)

        # Conversão de tipos
        if found_price is not None: details["price"] = self.parse_price_to_number(str(found_price)) if not isinstance(found_price, (int, float)) else float(found_price)
        details["area"] = float(found_area or 0)
        details["bedrooms"] = int(found_bedrooms or 0)
        details["bathrooms"] = int(found_bathrooms or 0)
        details["parking"] = int(found_parking or 0)
        details.update({"main_image_url": found_image, "advertiser": found_advertiser, "title": found_title})

        if found_date:
            details["date_text"] = found_date
            days_ago = None
            if source_log and "DETAIL_TEXT" in source_log and ("criado em" in found_date.lower()):
                md = re.search(r"(\d+)\s+de\s+(\w+)\s+de\s+(\d+)", found_date, re.I)
                if md:
                    months = {"janeiro": 1, "fevereiro": 2, "março": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12}
                    try:
                        dt = datetime(int(md.group(3)), months.get(md.group(2).lower(), 1), int(md.group(1)), tzinfo=timezone.utc)
                        details["published_at"], days_ago = dt, (datetime.now(timezone.utc) - dt).days
                    except Exception: pass
            
            if days_ago is None:
                d = self.calculate_days_ago(found_date)
                if d is not None:
                    days_ago = d
                    details["published_at"] = datetime.now(timezone.utc) - timedelta(days=d)

            if source_log:
                key_map = {"DETAIL_JSON": "date_found_detail_json", "DETAIL_SCRIPT_REGEX": "date_found_detail_regex", "DETAIL_TEXT": "date_found_detail_text"}
                for k, v in key_map.items():
                    if k in source_log: self.stats[v] += 1
            if days_ago is not None and days_ago <= 7: self.stats["final_under_7_days"] += 1
        else:
            self.stats["date_missing"] += 1
            self.stats["failure_reasons"]["No JSON/Script/Text match"] = self.stats["failure_reasons"].get("No JSON/Script/Text match", 0) + 1

        return details
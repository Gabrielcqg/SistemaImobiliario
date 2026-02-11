import unicodedata
import re
import json
import logging
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup

from app.scrapers.base import PortalScraper
from app.models.offer import OfferCard, Specs, Location
from app.utils.parsers import parse_ptbr_recency

logger = logging.getLogger(__name__)


class ImovelwebScraper(PortalScraper):
    BASE_URL = "https://www.imovelweb.com.br"

    # ============================================================
    # Helpers (mesma lógica do “isolated test” que deu certo)
    # ============================================================

    def slugify(self, text: str) -> str:
        if not text:
            return ""
        text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
        text = re.sub(r"[^\w\s-]", "", text).strip().lower()
        return re.sub(r"[-\s]+", "-", text)

    def _normalize_neighborhood(self, text: str) -> str:
        # Normalização leve pro bairro (mantém compat com DB / filtros)
        return self.slugify(text or "")

    def _extract_cards(self, soup: BeautifulSoup):
        # ✅ Prioriza o selector que funcionou no código bom
        cards = soup.select('div[class*="postingCard-module__posting-container"]')
        if not cards:
            cards = soup.select('div[data-qa="LISTING_CARD"]')
        if not cards:
            cards = soup.select(".posting-card")
        return cards

    def _extract_url(self, card) -> Optional[str]:
        link_node = (
            card.select_one('a[href*="/propriedades/"]')
            or card.select_one("div[data-to-posting]")
        )
        if not link_node:
            return None

        href = link_node.get("href") or link_node.get("data-to-posting")
        if not href:
            return None

        if href.startswith("http"):
            return href

        # garante que começa com "/"
        if not href.startswith("/"):
            href = "/" + href

        return self.BASE_URL + href

    def _extract_title(self, card) -> str:
        title_node = card.select_one("h2, [class*='postingsTitle-module__title']")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        return title if title else "Imóvel"

    def _extract_price_value(self, card) -> float:
        price_node = card.select_one(
            '[data-qa="POSTING_CARD_PRICE"], [class*="postingPrices-module__price"]'
        )
        if not price_node:
            return 0.0

        p_text = price_node.get_text(" ", strip=True)
        # pega só dígitos (ex: "R$ 450.000" -> 450000)
        clean_p = re.sub(r"[^\d]", "", p_text or "")
        try:
            return float(clean_p) if clean_p else 0.0
        except Exception:
            return 0.0

    def _extract_specs(self, card) -> Specs:
        specs = Specs(area=0, bedrooms=0, bathrooms=0, parking=0)

        feat_node = card.select_one('[class*="postingMainFeatures"]')
        if not feat_node:
            return specs

        text = feat_node.get_text(" ", strip=True)

        m_area = re.search(r"(\d+)\s*m²", text, re.I)
        if m_area:
            specs.area = int(m_area.group(1))

        m_bed = re.search(r"(\d+)\s*quart", text, re.I)
        if m_bed:
            specs.bedrooms = int(m_bed.group(1))

        m_bath = re.search(r"(\d+)\s*ban", text, re.I)
        if m_bath:
            specs.bathrooms = int(m_bath.group(1))

        m_park = re.search(r"(\d+)\s*vag", text, re.I)
        if m_park:
            specs.parking = int(m_park.group(1))

        return specs

    def _extract_location_imovelweb(self, card):
        """
        Mesma lógica do código que funcionou:

        <div class="postingLocations-module__location-block">
          <h4 class="postingLocations-module__location-address ...">Rua ...</h4>
          <h4 class="postingLocations-module__location-text" data-qa="POSTING_CARD_LOCATION">Centro, Campinas</h4>
        </div>

        Retorna: (street, bairro, cidade, loc_text)
        """
        street_node = card.select_one('[class*="postingLocations-module__location-address"]')
        street = street_node.get_text(" ", strip=True) if street_node else "NA"

        loc_node = card.select_one(
            '[data-qa="POSTING_CARD_LOCATION"], [class*="postingLocations-module__location-text"]'
        )
        loc_text = loc_node.get_text(" ", strip=True) if loc_node else "NA"

        bairro = "NA"
        cidade = "NA"
        if loc_text != "NA":
            parts = [p.strip() for p in loc_text.split(",", 1)]
            if len(parts) >= 1 and parts[0]:
                bairro = parts[0]
            if len(parts) == 2 and parts[1]:
                cidade = parts[1]

        return street, bairro, cidade, loc_text

    def _extract_advertiser_logo_url(self, card) -> str:
        """
        Logo URL (não nome), como no código bom:
        <img data-qa="POSTING_CARD_PUBLISHER" src="https://imgbr.imovelwebcdn.com/empresas/...jpg" />
        """
        logo_node = card.select_one(
            'img[data-qa="POSTING_CARD_PUBLISHER"], img[class*="postingPublisher-module__logo"]'
        )
        if logo_node:
            src = logo_node.get("src") or logo_node.get("data-src")
            return src if src else "NA"

        # fallback: img que parece logo de empresa
        for img in card.select("img"):
            src = img.get("src") or img.get("data-src") or ""
            if "/empresas/" in src and ("logo" in src or "empresas" in src):
                return src

        return "NA"

    def _extract_main_image(self, card) -> str:
        """
        Evita pegar a logo do anunciante como imagem principal.
        Pega a primeira <img> que NÃO pareça publisher/logo.
        """
        for img in card.select("img"):
            # não pegar publisher
            if img.get("data-qa") == "POSTING_CARD_PUBLISHER":
                continue

            cls = " ".join(img.get("class", []))
            if "postingPublisher-module__logo" in cls or "postingPublisher" in cls:
                continue

            src = img.get("src") or img.get("data-src") or ""
            if not src:
                continue

            # evita logos
            if "/empresas/" in src or "logo_" in src or "logo" in src:
                continue

            return src

        return "NA"

    def _extract_date_text(self, card) -> Optional[str]:
        date_node = card.find(string=re.compile(r"Publicado|criado em", re.I))
        if date_node:
            txt = (date_node or "").strip()
            return txt if txt else None
        return None

    def _extract_date_from_jsonld(self, card) -> Optional[str]:
        """
        Tenta pegar datePosted do JSON-LD do card.
        Pode vir como dict, ou lista de dicts.
        """
        script = card.select_one('script[type="application/ld+json"]')
        if not script or not script.string:
            return None

        try:
            data = json.loads(script.string)

            # pode ser lista
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("datePosted"):
                        return item.get("datePosted")
                return None

            # dict
            if isinstance(data, dict):
                if data.get("datePosted"):
                    return data.get("datePosted")
        except Exception:
            return None

        return None

    def _extract_external_id(self, url: str) -> str:
        # tenta id-123... primeiro
        m = re.search(r"id-(\d+)", url)
        if m:
            return m.group(1)

        # fallback: último bloco do slug
        tail = url.split("/")[-1]
        tail = tail.replace(".html", "")
        parts = tail.split("-")
        return parts[-1] if parts else tail

    # ============================================================
    # URL builder (mantém o seu, mas ok)
    # ============================================================

    def build_url(self, city: str, state: str, filters: dict, page: int) -> str:
        operation = "venda" if filters.get("operation") == "sale" else "aluguel"
        ptype = filters.get("property_type", "apartamentos")
        if ptype == "apartment":
            ptype = "apartamentos"
        elif ptype == "house":
            ptype = "casas"

        neighborhood = self.slugify(filters.get("query", ""))
        city_slug = self.slugify(city)

        path_parts = [ptype, operation]
        if neighborhood:
            path_parts.append(neighborhood)
        path_parts.append(city_slug)
        path_parts.append(state.lower())

        beds = filters.get("bedrooms_min")
        if beds:
            path_parts.append(f"mais-de-{beds}-quarto" if int(beds) == 1 else f"mais-de-{beds}-quartos")

        price_min = filters.get("price_min")
        price_max = filters.get("price_max")
        if price_min and price_max:
            path_parts.append(f"{price_min}-{price_max}-reales")
        elif price_min:
            path_parts.append(f"mais-{price_min}-reales")
        elif price_max:
            path_parts.append(f"ate-{price_max}-reales")

        path_parts.append("ordem-publicado-maior")

        base_url_path = "-".join(path_parts)
        url = f"{self.BASE_URL}/{base_url_path}.html"

        if page > 1:
            url = url.replace(".html", f"-pagina-{page}.html")

        return url

    # ============================================================
    # Date parsing / days_ago robusto (não depende do base)
    # ============================================================

    def calculate_days_ago(self, date_text: Optional[str]) -> int:
        """
        Converte coisas como:
          - "Publicado hoje" -> 0
          - "Publicado ontem" -> 1
          - "Publicado há 2 dias" -> 2
          - "criado em 10/01/2026" -> diff
          - ISO "2025-11-18T07:51:57.848Z" -> diff

        Se não conseguir, retorna um número alto (pra cair fora no filtro de recência).
        """
        if not date_text:
            return 9999

        raw = (date_text or "").strip()

        # 1) tenta parser existente do seu projeto (se retornar int, melhor)
        try:
            parsed = parse_ptbr_recency(raw)
            if isinstance(parsed, int):
                return parsed
        except Exception:
            pass

        txt = raw.lower()

        # 2) pt-BR relativo
        if "hoje" in txt:
            return 0
        if "ontem" in txt:
            return 1

        # "há X dias"
        m = re.search(r"h[áa]\s*(\d+)\s*dia", txt)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                return 9999

        # 3) "criado em dd/mm/aaaa" ou texto com dd/mm/aaaa
        m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", txt)
        if m:
            try:
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
                dt = datetime(y, mo, d, tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                return max(0, (now - dt).days)
            except Exception:
                return 9999

        # 4) ISO datetime
        iso = raw
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            return max(0, (now - dt).days)
        except Exception:
            return 9999

    # ============================================================
    # Core parser (aqui é onde estava “dando errado”)
    # ============================================================

    def parse_cards(self, html: str, recency_days: int) -> List[OfferCard]:
        soup = BeautifulSoup(html, "html.parser")

        cards = self._extract_cards(soup)
        results: List[OfferCard] = []

        for card in cards:
            try:
                # -- URL --
                url = self._extract_url(card)
                if not url:
                    continue

                # -- Title --
                title = self._extract_title(card)

                # -- Price --
                price_val = self._extract_price_value(card)

                # -- Specs --
                specs = self._extract_specs(card)

                # -- Location (rua + bairro/cidade) --
                street, bairro, cidade, loc_text = self._extract_location_imovelweb(card)

                # defaults seguros
                state = "SP"
                city_final = cidade if cidade != "NA" else "Campinas"
                neighborhood_final = bairro if bairro != "NA" else ""

                # -- Advertiser Logo URL (como no código bom) --
                advertiser_logo_url = self._extract_advertiser_logo_url(card)

                # -- Advertiser name (opcional, tenta pegar se existir) --
                advertiser_name = None
                adv_alt = card.select_one('img[data-qa="POSTING_CARD_PUBLISHER"]')
                if adv_alt:
                    alt = adv_alt.get("alt")
                    if alt and len(alt.strip()) >= 3:
                        advertiser_name = alt.strip()

                if not advertiser_name:
                    txt_node = card.find(string=re.compile("Anunciado por", re.I))
                    if txt_node:
                        advertiser_name = str(txt_node).replace("Anunciado por", "").strip()

                # -- Date (texto + JSON-LD fallback) --
                date_text = self._extract_date_text(card)
                if not date_text:
                    date_text = self._extract_date_from_jsonld(card)

                days_ago = self.calculate_days_ago(date_text)

                # filtro de recência
                if recency_days is not None and days_ago > recency_days:
                    continue

                # -- Main image (não pegar logo) --
                img_src = self._extract_main_image(card)
                main_image_url = img_src if img_src != "NA" else None

                now_utc = datetime.now(timezone.utc)

                offer = OfferCard(
                    portal="imovelweb",
                    external_id=self._extract_external_id(url),
                    title=title,
                    url=url,
                    price=price_val,
                    agency_name=advertiser_name,  # mantém compat com seu model atual
                    specs=specs,
                    location=Location(
                        city=city_final,
                        state=state,
                        neighborhood=self._normalize_neighborhood(neighborhood_final) if neighborhood_final else "",
                    ),
                    published_days_ago=days_ago if days_ago != 9999 else None,
                    published_at=(now_utc - timedelta(days=days_ago)) if days_ago != 9999 else None,
                    last_seen=now_utc,
                    main_image_url=main_image_url,
                )

                # ✅ tenta setar logo URL se seu OfferCard tiver esse campo
                try:
                    if hasattr(offer, "agency_logo_url"):
                        setattr(offer, "agency_logo_url", None if advertiser_logo_url == "NA" else advertiser_logo_url)
                    elif hasattr(offer, "advertiser_logo_url"):
                        setattr(offer, "advertiser_logo_url", None if advertiser_logo_url == "NA" else advertiser_logo_url)
                    elif hasattr(offer, "publisher_logo_url"):
                        setattr(offer, "publisher_logo_url", None if advertiser_logo_url == "NA" else advertiser_logo_url)
                except Exception:
                    # não quebra o parser por causa disso
                    pass

                # ✅ (opcional) se você tiver campo de rua no model (muitos não têm)
                try:
                    if hasattr(offer, "street"):
                        setattr(offer, "street", None if street == "NA" else street)
                except Exception:
                    pass

                results.append(offer)

            except Exception as e:
                logger.error(f"[Imovelweb] Error parsing card: {e}", exc_info=True)
                continue

        return results

    # ============================================================
    # Details (mantive o seu, só corrigindo normalização e guardas)
    # ============================================================

    def extract_details(self, html: str) -> dict:
        soup = BeautifulSoup(html, "html.parser")
        details = {}
        try:
            title_el = soup.select_one('h1[data-qa="POSTING_DETAILS_TITLE"], .section-title')
            details["title"] = title_el.get_text(strip=True) if title_el else "N/A"

            area_elem = soup.select_one('li[data-qa="POSTING_DETAILS_AREA"] span')
            details["area"] = float(re.sub(r"[^0-9]", "", area_elem.get_text())) if area_elem else 0

            rooms_elem = soup.select_one('li[data-qa="POSTING_DETAILS_BEDROOMS"] span')
            details["bedrooms"] = int(re.sub(r"[^0-9]", "", rooms_elem.get_text())) if rooms_elem else 0

            baths_elem = soup.select_one('li[data-qa="POSTING_DETAILS_BATHROOMS"] span')
            details["bathrooms"] = int(re.sub(r"[^0-9]", "", baths_elem.get_text())) if baths_elem else 0

            garages_elem = soup.select_one('li[data-qa="POSTING_DETAILS_GARAGES"] span')
            details["parking"] = int(re.sub(r"[^0-9]", "", garages_elem.get_text())) if garages_elem else 0

            # --- Fallbacks Robustos ---
            if details.get("area") == 0:
                m2_match = re.search(r"(\d+(?:\.\d+)?)\s*m²?", details["title"], re.I)
                if not m2_match:
                    m2_match = re.search(r"(\d+(?:[.,]\d+)?)\s*m²?", html, re.I)
                if m2_match:
                    val_str = m2_match.group(1)
                    if "," in val_str and "." in val_str:
                        val_str = val_str.replace(".", "").replace(",", ".")
                    elif "," in val_str:
                        val_str = val_str.replace(",", ".")
                    elif "." in val_str:
                        parts = val_str.split(".")
                        if len(parts[-1]) == 3:
                            val_str = val_str.replace(".", "")
                    details["area"] = float(val_str)

            if details.get("bedrooms") == 0:
                bed_match = re.search(r"(\d+)\s*Quarto", details["title"], re.I)
                if not bed_match:
                    bed_match = re.search(r"(\d+)\s*Quarto", html, re.I)
                if bed_match:
                    details["bedrooms"] = int(bed_match.group(1))

            price_elem = soup.select_one('[data-qa="POSTING_DETAILS_PRICE"]')
            if price_elem:
                details["price"] = float(re.sub(r"[^0-9]", "", price_elem.get_text()))
            else:
                price_match = re.search(r"R\$\s*([\d.]+)", html)
                if price_match:
                    price_str = price_match.group(1).replace(".", "")
                    if len(price_str) > 4:
                        details["price"] = float(price_str)

            img_elem = soup.select_one('img.is-selected') or soup.select_one('img[src*="isFirstImage=true"]')
            details["main_image_url"] = img_elem.get("src") if img_elem else None

            # --- Recência / Data ---
            antiquity_elem = soup.select_one('[class*="antiquity-views"]')
            if not antiquity_elem:
                antiquity_elem = soup.find(string=re.compile(r"Publicado há|Publicado|criado em", re.I))
                if antiquity_elem and hasattr(antiquity_elem, "parent"):
                    antiquity_elem = antiquity_elem.parent

            if antiquity_elem:
                details["date_text"] = antiquity_elem.get_text(strip=True)

            # Neighborhood from details
            loc_node = soup.select_one(".address, [data-qa='POSTING_CARD_LOCATION']")
            if loc_node:
                details["neighborhood"] = self._normalize_neighborhood(loc_node.get_text(strip=True))

            return details
        except Exception:
            return {}

    def extract_total_pages(self, html: str) -> int:
        match = re.search(r'"totalPages":(\d+)', html)
        if match:
            return int(match.group(1))
        soup = BeautifulSoup(html, "html.parser")
        paging_items = soup.select(".paging-module__page-item")
        numbers = [int(i.get_text(strip=True)) for i in paging_items if i.get_text(strip=True).isdigit()]
        return max(numbers) if numbers else 1

    def is_blocked(self, html: str) -> bool:
        if not html:
            return True
            
        # Success indicators (if specific card classes are present, it's NOT blocked)
        if 'postingCard' in html or 'data-qa="LISTING_CARD"' in html:
            return False
            
        # Definite block indicators
        soup = BeautifulSoup(html, "html.parser")
        title = soup.title.string.strip() if soup.title else ""
        
        if "Just a moment" in title or "Access Denied" in title:
            return True
            
        if "Attention Required" in title or "Cloudflare" in title:
            # But double check if content is missing
            if "postingCard" not in html:
                return True
                
        return False

    def is_incomplete(self, html: str) -> bool:
        return "posting" not in html and "POSTING_CARD" not in html

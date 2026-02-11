import unicodedata
import re
import json
import logging
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta

from bs4 import BeautifulSoup
from bs4.element import NavigableString

from app.scrapers.base import PortalScraper
from app.models.offer import OfferCard, Specs, Location
from app.utils.parsers import parse_ptbr_recency

logger = logging.getLogger(__name__)


class ZapScraper(PortalScraper):
    BASE_URL = "https://www.zapimoveis.com.br"

    def __init__(self):
        super().__init__()
        self.stats = {
            "total_links": 0,
            "date_found_list": 0,
            "date_found_detail_json": 0,
            "date_found_detail_regex": 0,
            "date_found_detail_text": 0,
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
        print("\n📊 [ZAP] RELATÓRIO FINAL DE EXTRAÇÃO")
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
            return ZapScraper.BASE_URL + url
        return ZapScraper.BASE_URL + "/" + url

    # -------------------------
    # ✅ NOVAS FUNÇÕES (MESMA LÓGICA DO CÓDIGO QUE DEU CERTO)
    # -------------------------
    @staticmethod
    def _normalize_dashes(s: str) -> str:
        # normaliza hífens/travessões diferentes para " – "
        return re.sub(r"\s*[—–-]\s*", " – ", (s or "").strip())

    @classmethod
    def extract_location_parts_from_address(cls, address: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Mesma lógica do código "que deu certo".

        Exemplos:
          "Rua César Ladeira – Vila Nova Teixeira, Campinas – SP"
          "Rua Padre Vieira 1116 – Centro, Campinas – SP"
          "Centro, Campinas – SP"
          "Rua X, 123, Centro, Campinas – SP"

        Retorna: (street, bairro, cidade, uf)
          - street pode ser None
          - bairro/cidade podem ser None se falhar
        """
        if not address:
            return (None, None, None, None)

        s = cls._normalize_dashes(address)

        # UF no final: " – SP"
        uf = None
        m_uf = re.search(r"\s+–\s*([A-Za-z]{2})$", s)
        if m_uf:
            uf = m_uf.group(1).upper()
            s = s[: m_uf.start()].strip()

        street = None
        bairro = None
        cidade = None

        # Caso 1: "RUA – BAIRRO, CIDADE"
        if " – " in s:
            left, right = s.split(" – ", 1)
            left = left.strip()
            right = right.strip()

            if left:
                street = left

            if "," in right:
                p1, p2 = [x.strip() for x in right.split(",", 1)]
                bairro = p1 if p1 else None
                cidade = p2 if p2 else None
            else:
                bairro = right if right else None

            return (street, bairro, cidade, uf)

        # Caso 2: sem " – " (pode ser só "Bairro, Cidade" ou "Rua, Bairro, Cidade")
        if "," in s:
            parts = [p.strip() for p in s.split(",") if p.strip()]
            if len(parts) == 2:
                bairro, cidade = parts[0], parts[1]
            elif len(parts) >= 3:
                cidade = parts[-1]
                bairro = parts[-2]
                street = ", ".join(parts[:-2]).strip() or None
            return (street, bairro, cidade, uf)

        # Caso 3: só um pedaço
        bairro = s.strip() or None
        return (street, bairro, cidade, uf)

    @classmethod
    def extract_location_parts_from_listing_text(
        cls, text: str, known_city: Optional[str] = None
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Fallback de listagem.

        Suporta:
          - "Centro, Campinas"
          - "Centro – Campinas"
          - "Campinas – SP"  (não vira bairro)
        Retorna: (bairro, cidade)
        """
        if not text:
            return (None, None)

        s = cls._normalize_dashes(text)

        # remove UF no final se existir
        m_uf = re.search(r"\s+–\s*([A-Za-z]{2})$", s)
        if m_uf:
            s = s[: m_uf.start()].strip()

        # caso "Bairro – Cidade"
        if " – " in s and "," not in s:
            left, right = [x.strip() for x in s.split(" – ", 1)]
            bairro = left or None
            cidade = right or None

            # evita transformar "Campinas" em bairro
            if known_city and bairro and bairro.lower() == known_city.lower():
                bairro = None
            return (bairro, cidade)

        # caso "Bairro, Cidade"
        if "," in s:
            p1, p2 = [x.strip() for x in s.split(",", 1)]
            bairro = p1 if p1 else None
            cidade = p2 if p2 else None

            # evita "Campinas" virar bairro
            if known_city and bairro and bairro.lower() == known_city.lower():
                bairro = None
            return (bairro, cidade)

        # sem separadores
        if known_city and re.search(rf"\b{re.escape(known_city)}\b", s, re.I):
            # se só fala a cidade, não seta bairro
            return (None, known_city)
        return (s if s else None, None)

    # Mantém compatibilidade (se alguém usa isso em outro lugar)
    @staticmethod
    def extract_bairro_from_address(address: str) -> Optional[str]:
        """
        Mantido por compatibilidade, mas agora usa o parser completo.
        """
        if not address:
            return None
        # fallback simples: pega o bairro pelo parser novo
        # (street, bairro, cidade, uf)
        street, bairro, cidade, uf = ZapScraper.extract_location_parts_from_address(address)
        return bairro

    def calculate_days_ago(self, date_input: str) -> Optional[int]:
        """ISO -> delta; texto pt-br -> parse_ptbr_recency."""
        if not date_input:
            return None

        # 1) ISO
        try:
            clean_date = date_input.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_date)
            now = datetime.now(timezone.utc)
            delta = now - dt
            return max(0, delta.days)
        except Exception:
            pass

        # 2) Texto relativo (Publicado há X dias / hoje / ontem)
        try:
            return parse_ptbr_recency(date_input)
        except Exception:
            return None

    @staticmethod
    def parse_city_state_from_url(url: str) -> Tuple[str, str]:
        """
        Zap URLs: /venda/imoveis/sp+campinas/...
        """
        if not url:
            return ("Campinas", "SP")

        u = url.lower()

        # Zap pattern: /sp+campinas/
        m = re.search(r"/([a-z]{2})\+([a-z0-9-]+)/", u)
        if m:
            st = m.group(1).upper()
            city_slug = m.group(2).replace("-", " ").strip()
            city = city_slug.title()
            return (city, st)

        return ("Campinas", "SP")

    @staticmethod
    def parse_price_to_number(price_text: str) -> Optional[float]:
        if not price_text:
            return None
        # Ex: "R$ 450.000" / "R$ 1.250.000"
        m = re.search(r"R\$\s*([\d\.\,]+)", price_text)
        if not m:
            m = re.search(r"([\d\.\,]+)", price_text)
        if not m:
            return None
        raw = m.group(1)
        raw = raw.replace(".", "").replace(",", ".")
        try:
            return float(raw)
        except Exception:
            return None

    # -------------------------
    # URL Builder
    # -------------------------
    def build_url(self, city: str, state: str, filters: dict, page: int) -> str:
        operation = "venda" if filters.get("operation") == "sale" else "aluguel"
        ptype = filters.get("property_type", "apartamentos")
        if ptype == "apartment":
            ptype = "apartamentos"
        elif ptype == "house":
            ptype = "casas"

        city_slug = self.slugify(city)
        state_slug = self.slugify(state)
        neighborhood_slug = self.slugify(filters.get("query", ""))
        beds_min = filters.get("bedrooms_min")

        path_suffix = ""
        if beds_min:
            path_suffix = f"{beds_min}-quartos/"

        # O ZAP usa o formato sp+campinas++bairro
        location_part = f"{state_slug}+{city_slug}"
        if neighborhood_slug:
            location_part += f"++{neighborhood_slug}"

        url = f"{self.BASE_URL}/{operation}/{ptype}/{location_part}/{path_suffix}"

        params = []
        price_min = filters.get("price_min")
        if price_min:
            params.append(f"precoMinimo={price_min}")

        price_max = filters.get("price_max")
        if price_max:
            params.append(f"precoMaximo={price_max}")

        if beds_min:
            beds_list = [str(i) for i in range(int(beds_min), int(beds_min) + 3)]
            params.append(f"quartos={','.join(beds_list)}")

        if page > 1:
            params.append(f"pagina={page}")

        if params:
            url += f"?{'&'.join(params)}"

        return url

    # -------------------------
    # Parse LISTING page
    # -------------------------
    # -------------------------
    # Parse LISTING page
    # -------------------------
    def _extract_next_data(self, soup: BeautifulSoup) -> Dict[str, Dict[str, Any]]:
        """
        Tenta extrair dados do JSON __NEXT_DATA__ (comum em sites Next.js como Zap/VivaReal).
        Retorna mapa: external_id -> {published_at, agency_name, ...}
        """
        data_map = {}
        try:
            script = soup.find("script", {"id": "__NEXT_DATA__"})
            if not script:
                return {}
            
            json_blob = json.loads(script.string)
            # Navegar até a lista de props... initialProps... pageProps...
            # Estrutura varia, então fazemos busca recursiva por objetos que parecem listings
            
            def find_listings(obj):
                if isinstance(obj, dict):
                    # Identificar objeto de listing
                    if "listing" in obj and "link" in obj:
                        l = obj["listing"]
                        link = obj["link"]
                        # extrair
                        ext_id = l.get("externalId") or l.get("id")
                        if ext_id:
                            # Date
                            dt = l.get("createdAt") or l.get("updatedAt") or l.get("publicationDate")
                            pub_at = None
                            if dt:
                                try:
                                    pub_at = datetime.fromisoformat(dt.replace("Z", "+00:00"))
                                except: pass
                            
                            # Advertiser
                            adv = None
                            account = l.get("account") or l.get("advertiser")
                            if account:
                                adv = account.get("name")

                            data_map[str(ext_id)] = {
                                "published_at": pub_at,
                                "agency_name": adv,
                                # Pode extrair mais coisas se quiser (suites, etc)
                            }
                    
                    # Recursão
                    for k, v in obj.items():
                        find_listings(v)
                elif isinstance(obj, list):
                    for item in obj:
                        find_listings(item)

            find_listings(json_blob)
        except Exception:
            pass
        return data_map

    def parse_cards(self, html: str, recency_days: int) -> List[OfferCard]:
        soup = BeautifulSoup(html or "", "html.parser")

        # Tenta extrair dados ricos do JSON escondido
        next_data_map = self._extract_next_data(soup)

        containers = soup.select(
            'div[data-testid="listing-card"], a.olx-core-surface, .listing-card__container'
        )

        if not containers:
            if self.is_blocked(html):
                self.stats["failure_reasons"]["blocked_listing"] = self.stats["failure_reasons"].get("blocked_listing", 0) + 1
            else:
                self.stats["failure_reasons"]["no_cards_listing"] = self.stats["failure_reasons"].get("no_cards_listing", 0) + 1
            return []

        url_map: Dict[str, Dict[str, Any]] = {}

        for container in containers:
            try:
                # 1) URL
                a = (
                    container.select_one('a[href*="/imovel/"]')
                    or container.select_one('a[href^="/imovel/"]')
                    or (container if container.name == "a" else None)
                    or container.select_one("a[href]")
                )
                href = a.get("href") if a else None
                abs_url = self.to_absolute(href) if href else ""
                norm_url = self.normalize_url(abs_url)
                if not norm_url or "/imovel/" not in norm_url:
                    continue

                if norm_url not in url_map:
                    url_map[norm_url] = {
                        "url": norm_url,
                        "title": None,
                        "price": None,
                        "specs": {},
                        "image_url": None,
                        # ✅ agora separa bairro/cidade fallback (igual código certo)
                        "neighborhood_fallback": None,
                        "city_fallback": None,
                        # compat com seu campo antigo
                        "location_fallback": None,
                        "published_at": None,
                        "agency_name": None,
                        "source_type": None
                    }

                # Tenta match com NEXT_DATA via external ID na URL (final do slug ou ID)
                # Ex: ...-id-2866696285 -> 2866696285
                ext_id_match = re.search(r"-id-(\d+)", norm_url)
                if ext_id_match:
                    eid = ext_id_match.group(1)
                    if eid in next_data_map:
                        nd = next_data_map[eid]
                        if nd.get("published_at"):
                            url_map[norm_url]["published_at"] = nd["published_at"]
                            url_map[norm_url]["source_type"] = "list_next_data"
                        if nd.get("agency_name"):
                             url_map[norm_url]["agency_name"] = nd["agency_name"]

                city_from_url, _uf_from_url = self.parse_city_state_from_url(norm_url)

                # 2) Title + fallback location (irmão do span)
                title_node = container.select_one("h2, .listing-card__title")
                loc_list_fallback = None

                if title_node:
                    span = title_node.select_one("span")
                    if span:
                        title_txt = span.get_text(" ", strip=True)
                        if title_txt:
                            url_map[norm_url]["title"] = url_map[norm_url]["title"] or title_txt

                        for sib in span.next_siblings:
                            if isinstance(sib, NavigableString):
                                t = str(sib).strip()
                                if t:
                                    loc_list_fallback = t
                                    break
                            else:
                                t = sib.get_text(" ", strip=True)
                                if t:
                                    loc_list_fallback = t
                                    break
                    else:
                        title_txt = title_node.get_text(" ", strip=True)
                        if title_txt:
                            url_map[norm_url]["title"] = url_map[norm_url]["title"] or title_txt

                # ✅ Fallback adicional por seletor de endereço na listagem (igual código certo)
                addr_list_node = container.select_one(
                    '[data-testid*="address"], [data-testid*="location"], [class*="address"], [class*="location"]'
                )
                if addr_list_node:
                    txt = addr_list_node.get_text(" ", strip=True)
                    if txt:
                        loc_list_fallback = txt

                # ✅ Parse do fallback (bairro, cidade) mais esperto
                if loc_list_fallback:
                    fb_bairro, fb_cidade = self.extract_location_parts_from_listing_text(
                        loc_list_fallback, known_city=city_from_url
                    )

                    if fb_bairro and not url_map[norm_url]["neighborhood_fallback"]:
                        url_map[norm_url]["neighborhood_fallback"] = fb_bairro
                        # compat
                        url_map[norm_url]["location_fallback"] = url_map[norm_url]["location_fallback"] or fb_bairro

                    if fb_cidade and not url_map[norm_url]["city_fallback"]:
                        url_map[norm_url]["city_fallback"] = fb_cidade

                # 3) Price
                price_node = container.select_one('.olx-core-price, .listing-card__price, [data-testid="price-value"]')
                if not price_node:
                    price_node = container.find(lambda tag: tag.name in ["p", "span"] and "R$" in tag.get_text())

                if price_node and not url_map[norm_url]["price"]:
                    p_txt = price_node.get_text(" ", strip=True)
                    p_num = self.parse_price_to_number(p_txt)
                    if p_num is not None:
                        url_map[norm_url]["price"] = p_num

                # 4) Specs
                specs = url_map[norm_url]["specs"] or {}

                def grab_int(selector: str, key: str):
                    node = container.select_one(selector)
                    if not node:
                        return
                    txt = node.get_text(" ", strip=True)
                    m = re.search(r"(\d+)", txt)
                    if m:
                        specs[key] = int(m.group(1))

                grab_int('li[data-cy*="propertyArea"], [data-cy*="area"]', "area")
                grab_int('li[data-cy*="bedroom"], [data-cy*="bedroom"]', "bedrooms")
                grab_int('li[data-cy*="bathroom"], [data-cy*="bathroom"]', "bathrooms")
                grab_int('li[data-cy*="parking"], [data-cy*="parking"]', "parking")

                # generic li selection for Zap
                if not specs:
                    for li in container.select('ul[class*="specs"] li, .listing-card__specs li'):
                        txt = li.get_text(" ", strip=True).lower()
                        val_m = re.search(r"(\d+)", txt)
                        if not val_m:
                            continue
                        val = int(val_m.group(1))
                        if "m²" in txt:
                            specs["area"] = val
                        elif "quarto" in txt:
                            specs["bedrooms"] = val
                        elif "banheiro" in txt:
                            specs["bathrooms"] = val
                        elif "vaga" in txt:
                            specs["parking"] = val

                url_map[norm_url]["specs"] = specs

                # 5) Image
                if not url_map[norm_url]["image_url"]:
                    img = container.select_one("img")
                    if img:
                        src = img.get("src") or img.get("data-src")
                        if src:
                            url_map[norm_url]["image_url"] = src

            except Exception as e:
                self.stats["failure_reasons"]["listing_parse_exception"] = self.stats["failure_reasons"].get("listing_parse_exception", 0) + 1
                logger.exception(f"[ZAP] erro parseando listing card: {e}")

        results: List[OfferCard] = []
        for norm_url, data in url_map.items():
            self.stats["total_links"] += 1

            city, state = self.parse_city_state_from_url(norm_url)

            # ✅ se a listagem trouxe cidade fallback, usa (não é obrigatório, mas ajuda)
            city_fb = data.get("city_fallback")
            if city_fb:
                city = city_fb

            s_data = data.get("specs") or {}
            specs = Specs(
                area=s_data.get("area", 0) or 0,
                bedrooms=s_data.get("bedrooms", 0) or 0,
                bathrooms=s_data.get("bathrooms", 0) or 0,
                parking=s_data.get("parking", 0) or 0,
            )

            neighborhood_fb = data.get("neighborhood_fallback") or ""
            if neighborhood_fb:
                self.stats["location_fallback_list"] += 1
            
            # Date + days ago
            pub_at = data.get("published_at")
            days_ago = 999
            if pub_at:
                diff = datetime.now(timezone.utc) - pub_at.replace(tzinfo=timezone.utc)
                days_ago = max(0, diff.days)
                self.stats["date_found_list"] += 1
            else:
                self.stats["date_missing"] += 1

            # Inject source metadata if possible (hacky way via private attr or dynamic)
            # We'll just rely on published_at being present

            results.append(
                OfferCard(
                    portal="zap",
                    external_id=norm_url.split("-")[-1].replace("/", ""),
                    title=data.get("title") or "Imóvel ZAP",
                    url=norm_url,
                    price=data.get("price") or 0,
                    main_image_url=data.get("image_url"),
                    agency_name=data.get("agency_name"),
                    specs=specs,
                    location=Location(
                        city=city,
                        state=state,
                        neighborhood=neighborhood_fb,
                        address=None,
                    ),
                    published_days_ago=days_ago,
                    published_at=pub_at,
                    last_seen=datetime.now(),
                )
            )

        return results

    # -------------------------
    # Enrich with DETAIL pages
    # -------------------------
    async def enrich_cards_with_details(
        self, fetcher, cards: List[OfferCard], delay_seconds: float = 1.0
    ) -> List[OfferCard]:
        enriched: List[OfferCard] = []

        for idx, card in enumerate(cards, 1):
            detail_url = getattr(card, "url", None)
            if not detail_url:
                enriched.append(card)
                continue

            detail_html = None
            try:
                detail_html = await fetcher.fetch(detail_url)
            except Exception:
                detail_html = None

            if not detail_html:
                self.stats["detail_fetch_fail"] += 1
                self.stats["failure_reasons"]["detail_html_empty"] = self.stats["failure_reasons"].get("detail_html_empty", 0) + 1
                enriched.append(card)
                continue

            if self.is_blocked(detail_html):
                self.stats["detail_blocked"] += 1
                self.stats["failure_reasons"]["detail_blocked"] = self.stats["failure_reasons"].get("detail_blocked", 0) + 1
                enriched.append(card)
                continue

            soup = BeautifulSoup(detail_html, "html.parser")

            # ✅ 1) Endereço completo via DETAIL (igual do código certo)
            address_text = None
            street_from_detail = None
            bairro_from_detail = None
            cidade_from_detail = None
            uf_from_detail = None

            try:
                addr_node = (
                    soup.select_one('[data-testid="location-address"]')
                    or soup.select_one('[data-testid="address"]')
                    or soup.select_one('[class*="address"]')
                    or soup.select_one('[class*="Address"]')
                )

                if addr_node:
                    address_text = addr_node.get_text(" ", strip=True)

                # Fallback: tenta achar uma string com "Campinas" no texto da página
                if not address_text:
                    for cand in soup.find_all(string=re.compile(r"\bCampinas\b", re.I)):
                        t = str(cand).strip()
                        if t and len(t) > 10:
                            address_text = t
                            break

                if address_text:
                    street_from_detail, bairro_from_detail, cidade_from_detail, uf_from_detail = (
                        self.extract_location_parts_from_address(address_text)
                    )

            except Exception:
                pass

            # ✅ 2) Details (data/anunciante/etc) - mantém sua lógica atual
            details = self.extract_details(detail_html) or {}

            # ✅ neighborhood final: prioridade DETAIL parsed > details > listing fallback
            nb_final = (
                bairro_from_detail
                or details.get("neighborhood")
                or getattr(card.location, "neighborhood", "")
                or ""
            )
            if bairro_from_detail:
                self.stats["location_found_detail"] += 1

            # ✅ city/state final: usa o que veio do address, senão mantém do card
            city_final = cidade_from_detail or getattr(card.location, "city", "Campinas")
            state_final = uf_from_detail or getattr(card.location, "state", "SP")

            # address (rua/logradouro)
            addr_final = street_from_detail or getattr(card.location, "address", None)

            # advertiser
            adv_final = details.get("advertiser") or getattr(card, "agency_name", None)

            # published
            published_at = details.get("published_at") or getattr(card, "published_at", None)
            published_days_ago = getattr(card, "published_days_ago", 999)

            if published_at and isinstance(published_at, datetime):
                diff = datetime.now(timezone.utc) - published_at.astimezone(timezone.utc)
                published_days_ago = max(0, diff.days)
            else:
                dt_text = details.get("date_text")
                d = self.calculate_days_ago(dt_text) if dt_text else None
                if d is not None:
                    published_days_ago = d
                    published_at = datetime.now(timezone.utc) - timedelta(days=d)

            title_final = getattr(card, "title", None) or details.get("title") or "Imóvel ZAP"
            price_final = getattr(card, "price", 0) or details.get("price") or 0
            img_final = getattr(card, "main_image_url", None) or details.get("main_image_url")

            # Specs merge (prioriza listing quando já tem)
            s = getattr(card, "specs", None)
            s_area = getattr(s, "area", 0) if s else 0
            s_bed = getattr(s, "bedrooms", 0) if s else 0
            s_bath = getattr(s, "bathrooms", 0) if s else 0
            s_park = getattr(s, "parking", 0) if s else 0

            specs_final = Specs(
                area=s_area or int(details.get("area") or 0),
                bedrooms=s_bed or int(details.get("bedrooms") or 0),
                bathrooms=s_bath or int(details.get("bathrooms") or 0),
                parking=s_park or int(details.get("parking") or 0),
            )

            if published_days_ago == 999:
                self.stats["date_missing"] += 1

            enriched.append(
                self._model_copy_card(
                    card,
                    update={
                        "title": title_final,
                        "price": price_final,
                        "main_image_url": img_final,
                        "agency_name": adv_final,
                        "specs": specs_final,
                        "location": Location(
                            city=city_final,
                            state=state_final,
                            neighborhood=nb_final,
                            address=addr_final,
                        ),
                        "published_at": published_at,
                        "published_days_ago": published_days_ago,
                        "last_seen": datetime.now(),
                    },
                )
            )

            try:
                import asyncio
                await asyncio.sleep(delay_seconds)
            except Exception:
                pass

        return enriched

    def _model_copy_card(self, card: OfferCard, update: Dict[str, Any]) -> OfferCard:
        if hasattr(card, "model_copy"):
            return card.model_copy(update=update)
        if hasattr(card, "copy"):
            return card.copy(update=update)
        for k, v in update.items():
            try:
                setattr(card, k, v)
            except Exception:
                pass
        return card

    # -------------------------
    # Pagination + Block checks
    # -------------------------
    def extract_total_pages(self, html: str) -> int:
        soup = BeautifulSoup(html or "", "html.parser")
        buttons = soup.select(".olx-core-pagination__button")
        pages = [int(b.get_text(strip=True)) for b in buttons if b.get_text(strip=True).isdigit()]
        return max(pages) if pages else 1

    def is_blocked(self, html: str) -> bool:
        if not html:
            return True
            
        # Success indicators
        if 'listing-card' in html or 'olx-core-surface' in html or 'listing-card__container' in html:
            return False
            
        # Definite block indicators
        soup = BeautifulSoup(html, "html.parser")
        title = soup.title.string.strip() if soup.title else ""
        
        if "Just a moment" in title or "Access Denied" in title:
            return True
            
        if "Attention Required" in title or "Cloudflare" in title:
             if 'listing-card' not in html and 'olx-core-surface' not in html:
                 return True

        return False

    def is_incomplete(self, html: str) -> bool:
        return "olx-core-surface" not in (html or "") and "listing-card" not in (html or "")

    # -------------------------
    # Detail extraction
    # -------------------------
    def extract_details(self, html: str) -> dict:
        soup = BeautifulSoup(html or "", "html.parser")
        details: Dict[str, Any] = {}

        found_date = None
        source_log = None

        found_price = None
        found_area = None
        found_bedrooms = None
        found_bathrooms = None
        found_parking = None
        found_title = None
        found_image = None
        found_advertiser = None
        found_neighborhood = None

        # ✅ usa o parser novo (bairro mais confiável)
        addr_node = (
            soup.select_one('[data-testid="location-address"]')
            or soup.select_one('[data-testid="address"]')
            or soup.select_one('[class*="address"]')
            or soup.select_one('[class*="Address"]')
        )
        if addr_node:
            address_text = addr_node.get_text(" ", strip=True)
            _street, bairro, _cidade, _uf = self.extract_location_parts_from_address(address_text)
            if bairro:
                found_neighborhood = bairro

        for script in soup.find_all("script", type="application/ld+json"):
            try:
                content = script.get_text()
                if not content:
                    continue
                data = json.loads(content)

                queue = [data]
                while queue:
                    curr = queue.pop(0)
                    if isinstance(curr, dict):
                        for key in ["datePosted", "datePublished", "createdAt", "updatedAt"]:
                            if not found_date and curr.get(key):
                                v = curr.get(key)
                                if isinstance(v, str) and (len(v) > 10 or "T" in v):
                                    found_date = v
                                    source_log = f"DETAIL_JSON ({key})"
                                    break

                        if not found_price and curr.get("price"):
                            found_price = curr.get("price")

                        if not found_area and curr.get("usableAreas"):
                            ua = curr.get("usableAreas")
                            if isinstance(ua, list) and ua:
                                found_area = ua[0]
                            elif isinstance(ua, (str, int)):
                                found_area = ua

                        if not found_bedrooms and curr.get("bedrooms"):
                            bd = curr.get("bedrooms")
                            if isinstance(bd, list) and bd:
                                found_bedrooms = bd[0]
                            elif isinstance(bd, (str, int)):
                                found_bedrooms = bd

                        if not found_bathrooms and curr.get("bathrooms"):
                            bt = curr.get("bathrooms")
                            if isinstance(bt, list) and bt:
                                found_bathrooms = bt[0]
                            elif isinstance(bt, (str, int)):
                                found_bathrooms = bt

                        if not found_parking and curr.get("parkingSpaces"):
                            pk = curr.get("parkingSpaces")
                            if isinstance(pk, list) and pk:
                                found_parking = pk[0]
                            elif isinstance(pk, (str, int)):
                                found_parking = pk

                        if not found_image and curr.get("images"):
                            imgs = curr.get("images")
                            if isinstance(imgs, list) and imgs:
                                if isinstance(imgs[0], dict) and "dangerousSrc" in imgs[0]:
                                    found_image = (
                                        imgs[0]["dangerousSrc"]
                                        .replace("{action}", "crop")
                                        .replace("{width}", "360")
                                        .replace("{height}", "240")
                                    )
                                elif isinstance(imgs[0], str):
                                    found_image = imgs[0]

                        if not found_title:
                            if curr.get("title"):
                                found_title = curr.get("title")
                            elif curr.get("pageTitle"):
                                found_title = curr.get("pageTitle")

                        if not found_advertiser:
                            adv = curr.get("advertiser") or curr.get("account") or curr.get("publisher")
                            if isinstance(adv, dict) and adv.get("name"):
                                found_advertiser = adv.get("name")
                            elif isinstance(adv, str):
                                found_advertiser = adv

                        if not found_neighborhood and curr.get("neighborhood"):
                            nb = curr.get("neighborhood")
                            if isinstance(nb, str):
                                found_neighborhood = nb

                        for v in curr.values():
                            if isinstance(v, (dict, list)):
                                queue.append(v)
                    elif isinstance(curr, list):
                        for item in curr:
                            if isinstance(item, (dict, list)):
                                queue.append(item)

                if found_date and found_advertiser and found_neighborhood:
                    break
            except Exception:
                continue

        if not found_date:
            for script in soup.find_all("script"):
                content = script.get_text()
                if not content:
                    continue
                for key in ["datePosted", "datePublished", "createdAt", "updatedAt"]:
                    if key not in content:
                        continue
                    m = re.search(rf'"{key}"\s*:\s*"(?P<date>[^"]+)"', content)
                    if m:
                        v = m.group("date")
                        if len(v) > 10 or "T" in v:
                            found_date = v
                            source_log = f"DETAIL_SCRIPT_REGEX ({key})"
                            break
                if found_date:
                    break

        if not found_date:
            main_content = soup.select_one("main") or soup.body
            if main_content:
                text = main_content.get_text(" ", strip=True)
                m1 = re.search(r"Anúncio criado em\s+(.*?)(?:,|$)", text, re.I)
                if m1:
                    found_date = m1.group(1).strip()
                    source_log = "DETAIL_TEXT_CREATED"
                else:
                    m2 = re.search(r"criado em\s+(.{0,40})", text, re.I)
                    if m2:
                        found_date = "criado em " + m2.group(1).strip()
                        source_log = "DETAIL_TEXT_GENERIC"

        if not found_advertiser:
            adv_node = soup.select_one(
                '[data-testid="advertiser-info-header"] a, .advertiser-info__name, [class*="AdvertiserName"]'
            )
            if adv_node:
                found_advertiser = adv_node.get_text(" ", strip=True)

        if not found_title:
            t_tag = soup.select_one("h1, title")
            if t_tag:
                found_title = t_tag.get_text(" ", strip=True)

        if found_price is not None:
            try:
                details["price"] = float(found_price)
            except Exception:
                pass

        if found_area is not None:
            try:
                details["area"] = float(found_area)
            except Exception:
                details["area"] = 0

        if found_bedrooms is not None:
            try:
                details["bedrooms"] = int(found_bedrooms)
            except Exception:
                details["bedrooms"] = 0

        if found_bathrooms is not None:
            try:
                details["bathrooms"] = int(found_bathrooms)
            except Exception:
                details["bathrooms"] = 0

        if found_parking is not None:
            try:
                details["parking"] = int(found_parking)
            except Exception:
                details["parking"] = 0

        if found_image:
            details["main_image_url"] = found_image
        if found_advertiser:
            details["advertiser"] = found_advertiser
        if found_title:
            details["title"] = found_title
        if found_neighborhood:
            details["neighborhood"] = (
                self._normalize_neighborhood(found_neighborhood)
                if hasattr(self, "_normalize_neighborhood")
                else found_neighborhood
            )

        if found_date:
            details["date_text"] = found_date
            days_ago = None

            if source_log and "DETAIL_TEXT" in source_log and ("criado em" in found_date.lower()):
                md = re.search(r"(\d+)\s+de\s+(\w+)\s+de\s+(\d+)", found_date, re.I)
                if md:
                    day, month_str, year = int(md.group(1)), md.group(2).lower(), int(md.group(3))
                    months = {
                        "janeiro": 1, "fevereiro": 2, "março": 3, "abril": 4, "maio": 5, "junho": 6,
                        "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12
                    }
                    month = months.get(month_str, 1)
                    try:
                        dt = datetime(year, month, day, tzinfo=timezone.utc)
                        details["published_at"] = dt
                        days_ago = (datetime.now(timezone.utc) - dt).days
                    except Exception:
                        pass

            if days_ago is None:
                d = self.calculate_days_ago(found_date)
                if d is not None:
                    days_ago = d
                    details["published_at"] = datetime.now(timezone.utc) - timedelta(days=d)

            if source_log:
                if "DETAIL_JSON" in source_log:
                    self.stats["date_found_detail_json"] += 1
                elif "DETAIL_SCRIPT_REGEX" in source_log:
                    self.stats["date_found_detail_regex"] += 1
                elif "DETAIL_TEXT" in source_log:
                    self.stats["date_found_detail_text"] += 1

            if days_ago is not None and days_ago <= 7:
                self.stats["final_under_7_days"] += 1
        else:
            reason = "no_date_source"
            self.stats["failure_reasons"][reason] = self.stats["failure_reasons"].get(reason, 0) + 1

        return details

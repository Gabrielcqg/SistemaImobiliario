import asyncio
import sys
import os
import re
from bs4 import BeautifulSoup
from bs4.element import NavigableString

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.scrapers.vivareal import VivaRealScraper
from app.scrapers.stealth import StealthFetcher

FIXED_URL = "https://www.vivareal.com.br/venda/sp/campinas/?transacao=venda&onde=%2CS%C3%A3o+Paulo%2CCampinas%2C%2C%2C%2C%2Ccity%2CBR%3ESao+Paulo%3ENULL%3ECampinas%2C-22.905082%2C-47.061333%2C&origem=busca-recente"


def normalize_dashes(s: str) -> str:
    # normaliza hífens/travessões diferentes para " – "
    return re.sub(r"\s*[—–-]\s*", " – ", s.strip())


def extract_location_parts_from_address(address: str):
    """
    Objetivo: extrair (rua, bairro, cidade, uf) de strings do VivaReal.

    Exemplos comuns:
      "Rua César Ladeira – Vila Nova Teixeira, Campinas – SP"
      "Vila Nova Teixeira, Campinas – SP"
      "Rua Padre Vieira 1116 – Centro, Campinas – SP"
      "Rua X, 123, Centro, Campinas – SP" (variações com vírgulas)

    Retorna: (street, bairro, cidade, uf)
      - street pode ser None se não existir
      - bairro/cidade podem ser None se falhar
    """
    if not address:
        return (None, None, None, None)

    s = normalize_dashes(address)

    # remove UF no final: " – SP"
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

        # Heurística: se o "left" parece rua/avenida, assume como street.
        if re.search(r"\b(Rua|Avenida|Av\.|Rodovia|Estrada|Travessa|Alameda)\b", left, re.I):
            street = left
        else:
            # pode ser um endereço sem "Rua", mas ainda assim é street
            # (ex: "Padre Vieira 1116 – Centro, Campinas")
            street = left

        # right: "Bairro, Cidade" (mais comum)
        if "," in right:
            p1, p2 = [x.strip() for x in right.split(",", 1)]
            bairro = p1 if p1 else None
            cidade = p2 if p2 else None
        else:
            # Se não tiver vírgula, assume que é bairro (e cidade fica None)
            bairro = right if right else None

        return (street, bairro, cidade, uf)

    # Caso 2: sem " – " (pode ser só "Bairro, Cidade" ou "Rua, Bairro, Cidade")
    if "," in s:
        parts = [p.strip() for p in s.split(",") if p.strip()]
        if len(parts) == 2:
            # "Bairro, Cidade"
            bairro, cidade = parts[0], parts[1]
        elif len(parts) >= 3:
            # "Rua..., Bairro, Cidade" (pega os 2 últimos como bairro/cidade)
            cidade = parts[-1]
            bairro = parts[-2]
            street = ", ".join(parts[:-2]).strip() or None
        return (street, bairro, cidade, uf)

    # Caso 3: só um pedaço (sem separadores) → melhor esforço: bairro
    bairro = s.strip() or None
    return (street, bairro, cidade, uf)


def extract_location_parts_from_listing_text(text: str):
    """
    Para fallback da listagem quando vier algo tipo:
      "Centro, Campinas"
    Retorna: (bairro, cidade)
    """
    if not text:
        return (None, None)

    s = text.strip()
    if "," not in s:
        return (s if s else None, None)

    p1, p2 = [x.strip() for x in s.split(",", 1)]
    bairro = p1 if p1 else None
    cidade = p2 if p2 else None
    return (bairro, cidade)


def val(values: dict, key: str) -> str:
    x = values.get(key)
    if x is None:
        return "NA"
    x = str(x).strip()
    return x if x else "NA"


async def test_isolation():
    print("🚀 INICIANDO TESTE ISOLADO: VIVAREAL")
    print(f"🔗 URL: {FIXED_URL}")
    print("=" * 60)

    import uuid
    run_id = str(uuid.uuid4())

    fetcher = StealthFetcher(headless=True)
    scraper = VivaRealScraper()

    try:
        html = await fetcher.fetch(FIXED_URL)
        if not html:
            print("❌ FALHA CRÍTICA: HTML vazio na página de busca.")
            return

        print("\n📊 RESUMO DA PÁGINA:")
        print("   Status Code: 200")
        print(f"   Tamanho HTML: {len(html)} bytes")

        soup = BeautifulSoup(html, "html.parser")

        cards_containers = soup.select(
            'li[data-cy="rp-property-cd"], .property-card__container, [data-testid="listing-card"]'
        )
        print(f"   Cards encontrados: {len(cards_containers)}")

        if not cards_containers:
            print("⚠️  Nenhum card encontrado! Verificando bloqueio...")
            if scraper.is_blocked(html):
                print("🚨 BLOQUEADO por WAF.")
            else:
                print("🔍 HTML parece normal mas seletores falharam. Salvando debug_search.html")
                with open("debug_search.html", "w", encoding="utf-8") as f:
                    f.write(html)
            return

        print("-" * 60)

        results = []

        for i, container in enumerate(cards_containers, 1):
            if i > 1: break # Limit check to 1 card for rapid verification
            card_data = {
                "index": i,
                "status": "OK",
                "values": {},
            }

            try:
                # URL
                link_elem = container.select_one("a")
                if link_elem:
                    url = link_elem.get("href", "")
                    if url:
                        if not url.startswith("http"):
                            url = "https://www.vivareal.com.br" + url
                        card_data["values"]["url"] = url

                # Title (somente span, para não misturar com localização)
                title_node = container.select_one("h2, .property-card__title")
                loc_list_fallback = None  # evita UnboundLocalError
                if title_node:
                    span = title_node.select_one("span")
                    if span:
                        card_data["values"]["title"] = span.get_text(" ", strip=True)

                        # Fallback opcional: pega o texto irmão do span (às vezes "Bairro, Campinas")
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
                        card_data["values"]["title"] = title_node.get_text(" ", strip=True)

                # Melhor fallback (tentativa) por seletor de endereço do card (se existir)
                # (se falhar, continua com o fallback do title sibling)
                addr_list_node = container.select_one(
                    '[data-testid*="address"], [data-cy*="address"], .property-card__address'
                )
                if addr_list_node:
                    txt = addr_list_node.get_text(" ", strip=True)
                    if txt:
                        loc_list_fallback = txt

                # Se existir fallback do bairro/cidade na listagem, salva como fallback separado
                if loc_list_fallback:
                    fb_bairro, fb_cidade = extract_location_parts_from_listing_text(loc_list_fallback)
                    if fb_bairro:
                        card_data["values"]["neighborhood_fallback"] = fb_bairro
                    if fb_cidade:
                        card_data["values"]["city_fallback"] = fb_cidade

                # Price (com espaço)
                price_node = container.select_one(
                    '[data-cy="rp-cardProperty-price-txt"], .property-card__price'
                )
                if price_node:
                    card_data["values"]["price"] = price_node.get_text(" ", strip=True)

                # Specs (Details) com espaço
                specs_list = container.select('li[data-cy*="cardProperty"]')
                if specs_list:
                    card_data["values"]["details"] = " | ".join(
                        [s.get_text(" ", strip=True) for s in specs_list]
                    )

                # Image
                img_node = container.select_one("img")
                if img_node:
                    img_src = img_node.get("src") or img_node.get("data-src")
                    if img_src:
                        card_data["values"]["image"] = img_src

                # --- DETAIL PAGE FETCH ---
                detail_url = card_data["values"].get("url")
                if detail_url:
                    print(f"📖 Lendo detalhes do Card {i}...")
                    detail_html = await fetcher.fetch(
                        detail_url, 
                        run_id=run_id, 
                        scenario="isolation", 
                        request_type="detail",
                        page_num=1,
                        card_index=i,
                        referer=FIXED_URL
                    )

                    if detail_html:
                        detail_soup = BeautifulSoup(detail_html, "html.parser")

                        # ✅ NOVA LÓGICA: rua/bairro/cidade pelo DETAIL
                        addr_node = detail_soup.select_one('[data-testid="location-address"]')
                        if addr_node:
                            address_text = addr_node.get_text(" ", strip=True)
                            card_data["values"]["address_full"] = address_text  # debug opcional

                            street, bairro, cidade, uf = extract_location_parts_from_address(address_text)

                            if street:
                                card_data["values"]["street"] = street
                            if cidade:
                                card_data["values"]["city"] = cidade
                            if uf:
                                card_data["values"]["uf"] = uf

                            if bairro:
                                # ✅ como você quer pro DB: location = bairro
                                card_data["values"]["location"] = bairro
                                card_data["values"]["neighborhood"] = bairro

                        # Mantém sua extração existente (data, advertiser)
                        scraper_details = scraper.extract_details(detail_html) or {}

                        # Advertiser
                        adv_name = scraper_details.get("advertiser")
                        if not adv_name:
                            adv_node = detail_soup.select_one(
                                '[data-cy="rp-advertiser-name"], .advertiser-info__name'
                            )
                            if adv_node:
                                adv_name = adv_node.get_text(" ", strip=True)

                        if adv_name:
                            card_data["values"]["advertiser"] = adv_name

                        # Published Date
                        pub_date = scraper_details.get("date_text") or scraper_details.get("published_at")
                        if pub_date:
                            card_data["values"]["published_date"] = str(pub_date)
                        else:
                            date_text_nodes = detail_soup.find_all(string=re.compile(r"criado em", re.I))
                            if date_text_nodes:
                                card_data["values"]["published_date"] = date_text_nodes[0].strip()

                        # ✅ Se não achou bairro/cidade no detail, usa fallback da listagem
                        if "neighborhood" not in card_data["values"] and card_data["values"].get("neighborhood_fallback"):
                            card_data["values"]["neighborhood"] = card_data["values"]["neighborhood_fallback"]
                            card_data["values"]["location"] = card_data["values"]["neighborhood_fallback"]

                        if "city" not in card_data["values"] and card_data["values"].get("city_fallback"):
                            card_data["values"]["city"] = card_data["values"]["city_fallback"]

                    else:
                        card_data["status"] = "FAIL"
                        card_data["error_type"] = "DetailFetchError"
                        card_data["error_message"] = "Detail HTML empty"

            except Exception as e:
                card_data["status"] = "FAIL"
                card_data["error_type"] = type(e).__name__
                card_data["error_message"] = str(e)

            v = card_data.get("values", {})
            log_line = (
                f"Card {i}: {card_data['status']} | "
                f"url={val(v, 'url')} | "
                f"image={val(v, 'image')} | "
                f"price={val(v, 'price')} | "
                f"title={val(v, 'title')} | "
                f"street={val(v, 'street')} | "
                f"neighborhood={val(v, 'neighborhood')} | "
                f"city={val(v, 'city')} | "
                f"location(bairro)={val(v, 'location')} | "
                f"details={val(v, 'details')} | "
                f"published_date={val(v, 'published_date')} | "
                f"advertiser={val(v, 'advertiser')}"
            )
            print(log_line)

            if card_data["status"] == "FAIL":
                print(f"   ❌ ERROR: {card_data.get('error_type')} - {card_data.get('error_message')}")

            results.append(card_data)
            await asyncio.sleep(1)

        print("\n" + "=" * 60)
        print(f"🏁 TESTE CONCLUÍDO. Total de cards processados: {len(results)}")

    finally:
        await fetcher.close()


if __name__ == "__main__":
    asyncio.run(test_isolation())
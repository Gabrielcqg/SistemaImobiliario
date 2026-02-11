import asyncio
import sys
import os
import re
import math
import json
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.scrapers.stealth import StealthFetcher

BASE_URL = "https://www.imovelweb.com.br/imoveis-venda-campinas-sp-ordem-publicado-maior.html"


def build_url_test(page: int) -> str:
    # Page 1: BASE_URL
    # Page N: BASE_URL.replace(".html", f"-pagina-{page}.html")
    if page <= 1:
        return BASE_URL

    if BASE_URL.endswith(".html"):
        return BASE_URL.replace(".html", f"-pagina-{page}.html")
    else:
        return f"{BASE_URL}-pagina-{page}.html"


def parse_relative_date(text: str) -> str:
    """
    "Publicado hoje" -> today
    "Publicado ontem" -> yesterday
    "Publicado há 2 dias" -> today - 2
    """
    text = (text or "").lower().strip()
    now = datetime.now(timezone.utc)

    if "hoje" in text:
        dt = now
    elif "ontem" in text:
        dt = now - timedelta(days=1)
    elif "hÃ¡" in text or "há" in text:  # handle encoding safety
        m = re.search(r"h[áa]\s+(\d+)\s+dias", text)
        if m:
            days = int(m.group(1))
            dt = now - timedelta(days=days)
        else:
            return text
    else:
        return text

    return dt.strftime("%d/%m/%Y")


def extract_location_imovelweb(card):
    """
    Usa exatamente o padrão do HTML informado:

    <div class="postingLocations-module__location-block">
      <h4 class="postingLocations-module__location-address ...">Rua ...</h4>
      <h4 class="postingLocations-module__location-text" data-qa="POSTING_CARD_LOCATION">Centro, Campinas</h4>
    </div>

    Retorna:
      street, bairro, cidade, raw_text ("Centro, Campinas")
    """
    street_node = card.select_one('[class*="postingLocations-module__location-address"]')
    street = street_node.get_text(" ", strip=True) if street_node else "NA"

    loc_node = card.select_one('[data-qa="POSTING_CARD_LOCATION"], [class*="postingLocations-module__location-text"]')
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


def extract_advertiser_logo(card):
    """
    Pega a imagem (URL) da logo do anunciante:

    <img data-qa="POSTING_CARD_PUBLISHER" src="https://imgbr.imovelwebcdn.com/empresas/...jpg" />

    Retorna a URL (string) ou "NA".
    """
    logo_node = card.select_one(
        'img[data-qa="POSTING_CARD_PUBLISHER"], img[class*="postingPublisher-module__logo"]'
    )
    if logo_node:
        src = logo_node.get("src") or logo_node.get("data-src")
        return src if src else "NA"

    # Fallback: qualquer img que pareça logo de empresa
    for img in card.select("img"):
        src = img.get("src") or img.get("data-src") or ""
        if "/empresas/" in src and "logo" in src:
            return src

    return "NA"


def extract_main_image(card):
    """
    Evita pegar a logo do anunciante como imagem principal do imóvel.
    Pega a primeira <img> que não pareça logo/publisher.
    """
    for img in card.select("img"):
        if img.get("data-qa") == "POSTING_CARD_PUBLISHER":
            continue

        cls = " ".join(img.get("class", []))
        if "postingPublisher-module__logo" in cls or "postingPublisher" in cls:
            continue

        src = img.get("src") or img.get("data-src") or ""
        if not src:
            continue

        if "/empresas/" in src or "logo_" in src or "logo" in src:
            continue

        return src

    return "NA"


async def test_imovelweb_isolation():
    print("🚀 INICIANDO TESTE ISOLADO: IMOVELWEB")
    print("=" * 60)

    # 1) URL Builder Test
    print("[1] Testando Montador de URL")
    u1 = build_url_test(1)
    u2 = build_url_test(2)
    print(f"  Page 1: {u1}")
    print(f"  Page 2: {u2}")

    if u1 == BASE_URL and "-pagina-2.html" in u2:
        print("  ✅ URL Builder: SUCESSO")
    else:
        print("  ❌ URL Builder: FALHA")

    print("-" * 60)

    # 2) Scraper Test (Página 1)
    print("[2] Testando Scraper (Página 1)")
    fetcher = StealthFetcher()

    try:
        html = await fetcher.fetch(BASE_URL)
        if not html:
            print("❌ FALHA CRÍTICA: HTML vazio.")
            return

        soup = BeautifulSoup(html, "html.parser")
        print(f"   HTML Size: {len(html)} bytes")

        # Block check
        if "Access Denied" in html or "challenged by Cloudflare" in html:
            print("🚨 BLOCKED BY WAF")

        # Selectors (CSS Modules)
        cards = soup.select('div[class*="postingCard-module__posting-container"]')
        if not cards:
            cards = soup.select('div[data-qa="LISTING_CARD"]')

        print(f"[IMOVELWEB][PAGE 1] cards_found={len(cards)}\n")

        if not cards:
            print("🔍 Saving debug_imovelweb.html for inspection...")
            with open("debug_imovelweb.html", "w", encoding="utf-8") as f:
                f.write(html)

        summary = {
            "ok": 0,
            "partial": 0,
            "missing_counts": {
                "url": 0,
                "title": 0,
                "price": 0,
                "main_image": 0,
                "specs": 0,
                "location": 0,
                "published_date": 0,
                "advertiser": 0,  # advertiser = logo URL
            },
        }

        for i, card in enumerate(cards, 1):
            missing = []

            # -- URL --
            link_node = card.select_one('a[href*="/propriedades/"]') or card.select_one("div[data-to-posting]")
            url = "NA"
            if link_node:
                href = link_node.get("href") or link_node.get("data-to-posting")
                if href:
                    if not href.startswith("http"):
                        url = "https://www.imovelweb.com.br" + href
                    else:
                        url = href

            # -- Title --
            title_node = card.select_one("h2, [class*='postingsTitle-module__title']")
            title = title_node.get_text(" ", strip=True) if title_node else "NA"

            # -- Price --
            price_node = card.select_one('[data-qa="POSTING_CARD_PRICE"], [class*="postingPrices-module__price"]')
            price = price_node.get_text(" ", strip=True) if price_node else "NA"

            # -- Image (main image do imóvel) --
            img_src = extract_main_image(card)

            # -- Specs --
            feat_node = card.select_one('[class*="postingMainFeatures"]')
            if feat_node:
                specs_str = feat_node.get_text(" | ", strip=True)
            else:
                specs_str = "NA"

            # -- Location (rua + bairro/cidade) --
            street, bairro, cidade, loc_text = extract_location_imovelweb(card)
            location = loc_text if loc_text != "NA" else "NA"

            # -- Advertiser (logo URL, não nome) --
            advertiser = extract_advertiser_logo(card)  # URL da logo

            # -- Date --
            pub_date = "NA"
            date_node = card.find(string=re.compile(r"Publicado|criado em", re.I))
            if date_node:
                pub_date = parse_relative_date(date_node.strip())

            # Fallback: JSON-LD (se existir)
            if pub_date == "NA":
                script = card.select_one('script[type="application/ld+json"]')
                if script and script.string:
                    try:
                        data = json.loads(script.string)
                        if "datePosted" in data and pub_date == "NA":
                            raw = data["datePosted"]
                            try:
                                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                                pub_date = dt.strftime("%d/%m/%Y")
                            except:
                                pub_date = raw
                    except:
                        pass

            # Checks (campos obrigatórios)
            if url == "NA":
                missing.append("url")
            if title == "NA":
                missing.append("title")
            if price == "NA":
                missing.append("price")
            if img_src == "NA":
                missing.append("main_image")
            if specs_str == "NA":
                missing.append("specs")

            # Localização: obrigatório existir POSTING_CARD_LOCATION separável em bairro e cidade
            if bairro == "NA" or cidade == "NA":
                missing.append("location")

            # Advertiser: obrigatório existir logo URL
            if advertiser == "NA":
                missing.append("advertiser")

            if pub_date == "NA":
                missing.append("published_date")

            # Status + Summary
            if missing:
                status = "PARTIAL" if len(missing) < 4 else "FAIL"
                summary["partial"] += 1
                for m in missing:
                    if m not in summary["missing_counts"]:
                        summary["missing_counts"][m] = 0
                    summary["missing_counts"][m] += 1
            else:
                status = "OK"
                summary["ok"] += 1

            # Print Card Log
            print(f"[{'CARD {:02d}'.format(i)}] {status}")
            print(f"  url: {'OK' if 'url' not in missing else 'MISSING'} | {url[:60]}...")
            print(f"  title: {'OK' if 'title' not in missing else 'MISSING'} | \"{title[:60]}\"")
            print(f"  price: {'OK' if 'price' not in missing else 'MISSING'} | {price}")
            print(
                f"  main_image: {'OK' if 'main_image' not in missing else 'MISSING'} | {img_src[:80]}..."
            )
            print(f"  specs: {'OK' if 'specs' not in missing else 'MISSING'} | {specs_str}")

            loc_ok = ("location" not in missing)
            print(
                f"  location: {'OK' if loc_ok else 'MISSING'} | "
                f"street=\"{street}\" | bairro=\"{bairro}\" | cidade=\"{cidade}\" | raw=\"{loc_text}\""
            )

            print(
                f"  published_date: {'OK' if 'published_date' not in missing else 'MISSING'} | {pub_date}"
            )

            print(
                f"  advertiser_logo: {'OK' if 'advertiser' not in missing else 'MISSING'} | {advertiser}"
            )

            print(f"  missing: {missing}")
            print()

        print("[SUMMARY]")
        print(f"ok={summary['ok']} partial={summary['partial']}")
        print(f"missing_counts: {summary['missing_counts']}")

    finally:
        await fetcher.close()


if __name__ == "__main__":
    asyncio.run(test_imovelweb_isolation())

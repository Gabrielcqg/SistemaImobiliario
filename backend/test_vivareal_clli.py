import asyncio
import sys
import os
import re
import random
from bs4 import BeautifulSoup
from curl_cffi import requests as cur_requests

# Ajuste de path para imports do seu projeto
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.scrapers.vivareal import VivaRealScraper
from app.scrapers.stealth import StealthFetcher

FIXED_URL = "https://www.vivareal.com.br/venda/sp/campinas/?transacao=venda&onde=%2CS%C3%A3o+Paulo%2CCampinas%2C%2C%2C%2C%2Ccity%2CBR%3ESao+Paulo%3ENULL%3ECampinas%2C-22.905082%2C-47.061333%2C&origem=busca-recente"

# --- UTILITÁRIOS DE TRATAMENTO ---

def normalize_dashes(s: str) -> str:
    return re.sub(r"\s*[—–-]\s*", " – ", s.strip())

def val(values: dict, key: str) -> str:
    x = values.get(key)
    return str(x).strip() if x else "NA"

# --- MOTOR DE BYPASS JA3 (CURL_CFFI) ---

def fetch_detail_with_bypass(url, referer):
    """
    Executa a requisição de detalhe mimetizando o fingerprint de rede de um Chrome real.
    """
    try:
        resp = cur_requests.get(
            url,
            impersonate="chrome120",
            headers={
                "Referer": referer,
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            },
            timeout=20
        )
        return resp.text if resp.status_code == 200 else None
    except Exception as e:
        print(f"   💥 Erro de conexão no curl_cffi: {e}")
        return None

# --- FUNÇÃO PRINCIPAL ---

async def test_isolation():
    print("\n" + "="*70)
    print("🚀 INICIANDO SCRAPER VIVAREAL: BUSCA + DETALHES (BYPASS CLOUDFLARE)")
    print("="*70)

    fetcher = StealthFetcher(headless=True)
    
    try:
        # 1. PEGAR A LISTAGEM (PLAYWRIGHT)
        print(f"📡 Carregando listagem: {FIXED_URL}")
        html_search = await fetcher.fetch(FIXED_URL)
        if not html_search:
            print("❌ Erro ao carrergar página de busca.")
            return

        soup_search = BeautifulSoup(html_search, "html.parser")
        cards = soup_search.select('li[data-cy="rp-property-cd"], .property-card__container, [data-testid="listing-card"]')
        print(f"📊 Encontrados {len(cards)} cards na página.\n")

        results = []

        for i, container in enumerate(cards, 1):
            card_data = {"index": i, "values": {}}
            
            # Extração de dados da lista
            link_elem = container.select_one("a")
            url = link_elem.get("href", "") if link_elem else ""
            if url and not url.startswith("http"):
                url = "https://www.vivareal.com.br" + url
            
            card_data["values"]["url"] = url
            
            price_node = container.select_one('[data-cy="rp-cardProperty-price-txt"], .property-card__price')
            card_data["values"]["price"] = price_node.get_text(" ", strip=True) if price_node else "NA"

            loc_node = container.select_one('.property-card__address, [data-testid="address"]')
            card_data["values"]["location"] = loc_node.get_text(" ", strip=True) if loc_node else "NA"

            # --- FETCH DO DETALHE (CURL_CFFI) ---
            if url:
                # Jitter Humano
                wait = random.uniform(3.0, 6.5)
                print(f"⏳ [{i}/{len(cards)}] Aguardando {wait:.2f}s...")
                await asyncio.sleep(wait)

                detail_html = fetch_detail_with_bypass(url, FIXED_URL)
                
                published_date = "NA"
                if detail_html:
                    detail_soup = BeautifulSoup(detail_html, "html.parser")
                    
                    # TENTATIVA 1: Seletor de classe específico
                    date_el = detail_soup.find("p", class_="text-neutral-110 text-1-5 font-secondary")
                    if date_el:
                        published_date = date_el.get_text(strip=True)
                    else:
                        # TENTATIVA 2: Busca por Regex (Fallback robusto)
                        fallback = detail_soup.find(string=re.compile(r"(Publicado há|Atualizado há)", re.I))
                        if fallback:
                            published_date = fallback.parent.get_text(strip=True)
                
                card_data["values"]["published_date"] = published_date

            # --- OUTPUT DE LOG E CONFERÊNCIA ---
            v = card_data["values"]
            print(f"🔹 CARD {i}")
            print(f"   💰 Preço: {v['price']}")
            print(f"   📍 Local: {v['location']}")
            
            if v["published_date"] == "NA":
                print(f"   📅 Data:  \033[91m{v['published_date']}\033[0m (NÃO ENCONTRADA)")
                print(f"   🔗 LINK PARA CONFERIR: {v['url']}")
            else:
                print(f"   📅 Data:  \033[92m{v['published_date']}\033[0m")
                print(f"   🔗 Link:  {v['url']}")
            
            print("-" * 40)
            results.append(card_data)

        print("\n" + "="*70)
        print(f"🏁 FIM DO TESTE. Total processado: {len(results)}")
        print("="*70)

    finally:
        await fetcher.close()

if __name__ == "__main__":
    asyncio.run(test_isolation())
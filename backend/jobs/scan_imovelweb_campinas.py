import asyncio
import sys
import os
import re
import argparse
import logging
import random
from pathlib import Path
from datetime import datetime, timezone

# Playwright
from playwright.async_api import async_playwright

# -----------------------------
# 1. Configuração e Env
# -----------------------------
env_path = Path(__file__).resolve().parent.parent / '.env'
if not env_path.exists(): 
    env_path = Path(__file__).resolve().parent / '.env'

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

try:
    from supabase import create_client
except ImportError:
    create_client = None

# Configuração de Logs (Extremamente verboso para debug)
logger = logging.getLogger("scan_quintoandar")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")

BASE_URL = "https://www.quintoandar.com.br/comprar/imovel/campinas-sp-brasil"

# -----------------------------
# 2. Utils e Parsers
# -----------------------------

def safe_int_str(text: str) -> int:
    try:
        clean = re.sub(r"[^\d]", "", text)
        return int(clean) if clean else 0
    except:
        return 0

def extract_external_id(url: str) -> str:
    match = re.search(r"/imovel/(\d+)", url)
    if match: return match.group(1)
    return str(random.randint(100000, 999999))

def check_is_new(text_date: str) -> bool:
    """True se for 'hora', 'minuto', 'agora', 'novo'."""
    if not text_date: return False
    clean = text_date.lower()
    return bool(re.search(r"(hora|minuto|segundo|agora|novo|hoje)", clean))

# -----------------------------
# 3. Funções de Filtro (DEBUG PESADO)
# -----------------------------

async def debug_and_force_filter(page):
    print("\n" + "="*50)
    print("🛠️  INICIANDO DEBUG DO FILTRO")
    print("="*50)

    # 1. Espera a barra de filtros carregar
    try:
        # Tenta achar o container geral dos chips de filtro
        await page.wait_for_selector('ul[role="tablist"]', timeout=10000)
        print("✅ Container de filtros (ul[role='tablist']) encontrado.")
    except:
        print("❌ Container de filtros NÃO encontrado. O layout pode ter mudado.")
    
    # 2. Procura especificamente o botão "Mais recentes"
    print("🔍 Procurando botão com texto 'Mais recentes'...")
    
    # Estratégia A: Pelo ID que você mandou (SORT_BUTTON)
    button_by_id = page.locator('#SORT_BUTTON')
    count_id = await button_by_id.count()
    
    # Estratégia B: Pelo texto visível
    button_by_text = page.locator('li', has_text="Mais recentes")
    count_text = await button_by_text.count()

    target_button = None

    if count_id > 0:
        print(f"✅ Botão encontrado pelo ID #SORT_BUTTON.")
        target_button = button_by_id.first
    elif count_text > 0:
        print(f"✅ Botão encontrado pelo TEXTO 'Mais recentes'.")
        target_button = button_by_text.first
    else:
        print("❌ CRÍTICO: Botão 'Mais recentes' NÃO foi encontrado na página.")
        # Debug: Imprimir o que existe na lista
        print("   --- HTML da lista de filtros para análise ---")
        try:
            filters_html = await page.inner_html('ul[role="tablist"]')
            print(filters_html[:500] + "... (truncado)")
        except:
            print("   (Não foi possível ler o HTML da lista)")
        return False

    # 3. Analisa o estado do botão
    if target_button:
        # Print do HTML do botão para ver se bate com o seu
        html_btn = await target_button.inner_html()
        print(f"📄 HTML do botão encontrado:\n{html_btn.strip()[:200]}...")

        aria_selected = await target_button.get_attribute("aria-selected")
        print(f"ℹ️ Estado atual (aria-selected): {aria_selected}")

        if aria_selected == "true":
            print("✅ O filtro JÁ ESTÁ ATIVO. Não precisa clicar.")
            return True
        else:
            print("🖱️ O filtro está desativado. CLICANDO AGORA...")
            
            # Captura o primeiro imóvel antes do clique para comparar depois
            first_card_before = await page.locator('div[data-testid="house-card"]').first.inner_text()
            first_line_before = first_card_before.split('\n')[0] if first_card_before else "Nada"
            
            await target_button.click()
            
            print("⏳ Aguardando atualização da lista (NetworkIdle)...")
            await page.wait_for_load_state("networkidle")
            await asyncio.sleep(4) # Espera extra para o React renderizar
            
            # Verificação Pós-Clique
            first_card_after = await page.locator('div[data-testid="house-card"]').first.inner_text()
            first_line_after = first_card_after.split('\n')[0] if first_card_after else "Nada"
            
            print(f"   Imóvel Topo ANTES: {first_line_before}")
            print(f"   Imóvel Topo DEPOIS: {first_line_after}")
            
            if first_line_before != first_line_after:
                print("✅ SUCESSO: A lista mudou após o clique.")
                return True
            else:
                print("⚠️ AVISO: A lista parece igual. O filtro funcionou? (Talvez o mais recente já fosse o primeiro)")
                return True

# -----------------------------
# 4. Navegação e Extração
# -----------------------------

async def get_details_date(context, card_element, index) -> str:
    """Abre aba, pega data, fecha aba."""
    page_detail = await context.new_page()
    try:
        # Pega o link
        href = await card_element.eval_on_selector("a", "el => el.href")
        print(f"   [Card {index}] Abrindo detalhe: {href}")
        
        await page_detail.goto(href)
        # Espera DOM
        await page_detail.wait_for_load_state("domcontentloaded")
        
        # Procura data
        try:
            # Tenta seletor principal
            locator = page_detail.locator('[data-testid="publication_date"]')
            await locator.wait_for(timeout=3000)
            text = await locator.inner_text()
            print(f"   [Card {index}] 📅 Data detectada: '{text}'")
            return text
        except:
            print(f"   [Card {index}] ❌ Elemento de data não achado (Timeout).")
            return ""
            
    except Exception as e:
        print(f"   [Card {index}] ❌ Erro técnico: {e}")
        return ""
    finally:
        await page_detail.close()

async def extract_card_data(card_element) -> Dict[str, Any]:
    # Extração rápida via JS para evitar latência
    data = await card_element.evaluate("""(card) => {
        const getText = (sel) => card.querySelector(sel)?.innerText || "";
        const getAttr = (sel, attr) => card.querySelector(sel)?.getAttribute(attr) || "";
        
        return {
            url: getAttr('a', 'href'),
            text: card.innerText,
            address: getText('[data-testid="house-card-address"]'),
            area: getText('[data-testid="house-card-area"]'),
            price: getText('[data-testid="house-card-price"]')
        }
    }""")
    
    full_url = "https://www.quintoandar.com.br" + data['url'] if data['url'].startswith("/") else data['url']

    return {
        "portal": "quintoandar",
        "url": full_url,
        "external_id": extract_external_id(full_url),
        "title": f"Imóvel em {data['address']}",
        "price": safe_int_str(data['price']),
        "published_at": datetime.now(timezone.utc).isoformat(),
        "raw_card_text": data['text']
    }

# -----------------------------
# 5. Execução Principal
# -----------------------------

async def run_scan(headless: bool):
    print("🚀 Iniciando Browser...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        
        print(f"🌍 Acessando URL Base: {BASE_URL}")
        await page.goto(BASE_URL)
        
        # Cookies
        try:
            print("🍪 Tentando fechar cookies...")
            await page.click('button:has-text("Aceitar")', timeout=3000)
        except:
            print("   (Sem modal de cookies)")

        # === CHAMADA DO DEBUGGER DE FILTRO ===
        await debug_and_force_filter(page)
        # =====================================

        card_selector = 'div[data-testid="house-card"]'
        print("⏳ Aguardando carregamento dos cards...")
        try:
            await page.wait_for_selector(card_selector, timeout=15000)
        except:
            print("❌ Timeout esperando cards. A página carregou?")
            await browser.close()
            return

        # === LÓGICA DE SALTO (STEP) ===
        step = 10
        current_index = 0
        last_valid_index = -1
        cutoff_index = -1
        found_cutoff = False
        
        print("\n🏁 INICIANDO LÓGICA DE SALTO (Verificando data a cada 10 cards)...")

        while not found_cutoff:
            # Scroll Infinito
            cards = await page.query_selector_all(card_selector)
            while len(cards) <= current_index + step:
                print(f"📜 Scroll down... (Cards carregados: {len(cards)} | Necessário: {current_index + step})")
                await page.mouse.wheel(0, 15000)
                await asyncio.sleep(3)
                cards = await page.query_selector_all(card_selector)
                
                # Checagem de fim de página
                new_len = len(cards)
                if new_len <= current_index:
                    print("⚠️ Fim da lista atingido (não carregou mais nada).")
                    cutoff_index = new_len - 1
                    found_cutoff = True
                    break

            if found_cutoff: break

            target_card = cards[current_index]
            print(f"\n🔍 Verificando Card Índice {current_index}...")
            
            date_text = await get_details_date(context, target_card, current_index)
            is_new = check_is_new(date_text)
            
            if is_new:
                print(f"✅ Card {current_index} é NOVO ({date_text}). Avançando...")
                last_valid_index = current_index
                current_index += step
            else:
                print(f"🛑 Card {current_index} é ANTIGO ({date_text}).")
                print(f"🔙 Iniciando BACKTRACK entre {last_valid_index} e {current_index} para achar o limite...")
                
                found_exact = False
                # Loop reverso do índice atual até o último válido
                for i in range(current_index - 1, last_valid_index, -1):
                    print(f"   Checking índice {i}...")
                    c_card = cards[i]
                    d_text = await get_details_date(context, c_card, i)
                    
                    if check_is_new(d_text):
                        print(f"🎉 CORTE LOCALIZADO! Card {i} é o último novo ({d_text}).")
                        cutoff_index = i
                        found_cutoff = True
                        found_exact = True
                        break
                
                if not found_exact:
                    # Se nenhum no meio do caminho for novo, o último novo era o last_valid_index
                    print(f"⚠️ Nenhum intermediário era novo. Corte mantido em {last_valid_index}.")
                    cutoff_index = last_valid_index
                    found_cutoff = True

        # === EXTRAÇÃO FINAL ===
        print("\n" + "="*50)
        print(f"💰 EXTRAINDO DADOS FINAIS (0 até {cutoff_index})")
        print("="*50)
        
        final_cards = await page.query_selector_all(card_selector)
        results = []
        
        for i in range(cutoff_index + 1):
            if i >= len(final_cards): break
            print(f"📥 Extraindo card {i}...")
            data = await extract_card_data(final_cards[i])
            results.append(data)

        print(f"\n✅ Concluído! {len(results)} imóveis novos capturados.")
        # Aqui você chamaria o save_to_supabase(results)
        
        await asyncio.sleep(2)
        await browser.close()

if __name__ == "__main__":
    # Rodar com headless=False para ver o navegador
    asyncio.run(run_scan(headless=False))
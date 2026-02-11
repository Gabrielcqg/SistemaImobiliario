import asyncio
import sys
import os
import re
import random
from pathlib import Path
from datetime import datetime, timezone

# Playwright
from playwright.async_api import async_playwright

# -----------------------------
# 1. Configuração
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

BASE_URL = "https://www.quintoandar.com.br/comprar/imovel/campinas-sp-brasil"

# -----------------------------
# 2. Utils e Parsers
# -----------------------------

def clean_number(text: str) -> float:
    if not text: return 0.0
    # Remove tudo que não é dígito, ponto ou vírgula
    clean = re.sub(r"[^\d,]", "", text)
    clean = clean.replace(",", ".")
    try: return float(clean)
    except: return 0.0

def clean_int(text: str) -> int:
    if not text: return 0
    clean = re.sub(r"[^\d]", "", text)
    try: return int(clean)
    except: return 0

def extract_external_id(url: str) -> str:
    match = re.search(r"/imovel/(\d+)", url)
    if match: return match.group(1)
    return str(random.randint(100000, 999999))

def normalize_property_type(text: str) -> str:
    # O QuintoAndar as vezes coloca o tipo em outro lugar, se não achar, assumimos apartamento
    if not text: return "apartment"
    t = text.lower()
    if "casa" in t: return "house"
    if "apartamento" in t: return "apartment"
    if "studio" in t or "kitnet" in t: return "studio"
    if "lote" in t or "terreno" in t: return "land"
    if "comercial" in t or "loja" in t: return "commercial"
    return "apartment"

def check_is_new(text_date: str) -> bool:
    if not text_date: return False
    return bool(re.search(r"(hora|minuto|segundo|agora|novo|hoje)", text_date.lower()))

# -----------------------------
# 3. Extração (NOVA LÓGICA)
# -----------------------------

# -----------------------------
# 3. Extração com DEBUG DETALHADO
# -----------------------------

# -----------------------------
# Novas Funções de Limpeza
# -----------------------------

# -----------------------------
# 2. Utils e Parsers (Adicione/Atualize estas funções)
# -----------------------------

def clean_neighborhood_name(text: str) -> str:
    if not text: return ""
    
    # 1. Remove sufixos de Cidade/Estado SEPARADOS por pontuação clara
    # Remove: " - Campinas", " (Campinas)", ", Campinas"
    # Mantém: "Jardim Campinas", "Chácara Campinas"
    text = re.sub(r"(\s+-\s+|\s+\(|\s+,)\s*campinas.*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(\s+-\s+|\s+\(|\s+,)\s*sp.*", "", text, flags=re.IGNORECASE)
    
    # 2. Remove parenteses soltos que sobraram
    text = text.replace("(", "").replace(")", "")
    
    # 3. Limpeza final básica
    text = text.replace(".", "").strip()
    
    # Se sobrou vazio ou muito curto, retorna vazio
    if len(text) < 2: return ""
    
    return text

def is_valid_neighborhood(text: str) -> bool:
    """Retorna False se o texto parecer um termo genérico e não um bairro."""
    if not text or len(text) < 3: return False
    
    t = text.lower().strip()
    
    # 1. Termos que, se estiverem CONTIDOS no nome, invalidam imediatamente
    # Isso mata "condomínio para comprar", "apto à venda", etc.
    forbidden_substrings = [
        "para comprar", "para alugar", "à venda", "a venda",
        "comprar", "alugar", "locação",
        "imóvel", "imovel", "residencial", 
        "próximo ao", "perto de", "com 1", "com 2", "com 3", "com 4"
    ]
    
    for term in forbidden_substrings:
        if term in t:
            return False

    # 2. Blacklist exata (palavras soltas proibidas)
    blacklist_exact = [
        "condomínio", "condominio", "apartamento", "casa", "studio", 
        "kitnet", "cobertura", "flat", "loft", "terreno", "lote",
        "andar", "bloco", "térreo", "sobrado"
    ]
    
    if t in blacklist_exact: return False
    
    # 3. Regra específica para "Condomínio" no início
    # Aceita "Condomínio Ouro Verde" (Bairro/Local), mas rejeita genéricos
    if t.startswith("condomínio") or t.startswith("condominio"):
        # Se tiver menos de 3 palavras, geralmente é genérico.
        # Ex: "Condomínio Fechado" -> Rejeita
        # Ex: "Condomínio Swiss Park" -> Aceita
        words = t.split()
        if len(words) <= 2 and ("fechado" in t or "clube" in t):
            return False
            
    return True

# -----------------------------
# 3. Extração (NOVA LÓGICA)
# -----------------------------

async def extract_card_data(card_element) -> dict:
    # 1. Extração Bruta
    raw = await card_element.evaluate("""(card) => {
        const getText = (sel) => card.querySelector(sel)?.innerText || "";
        const getAttr = (sel, attr) => card.querySelector(sel)?.getAttribute(attr) || "";
        
        const h2 = card.querySelector('h2');
        const specificAddress = card.querySelector('[data-testid="house-card-address"]');
        
        return {
            url: getAttr('a', 'href'),
            h2_text: h2 ? h2.innerText : "", 
            address_node_text: specificAddress ? specificAddress.innerText : "",
            price_text: getText('[data-testid="house-card-price"]'),
            full_text: card.innerText,
            img: card.querySelector('img')?.src || ""
        }
    }""")

    # --- SETUP ---
    full_url = "https://www.quintoandar.com.br" + raw['url'] if raw['url'].startswith("/") else raw['url']
    ext_id = extract_external_id(full_url)
    
    print(f"\n{'='*40}")
    print(f"🕵️  DEBUG CARD ID: {ext_id}")
    
    # Valores Padrão
    price = clean_number(raw['price_text'])
    condo = 0.0
    area = 0.0
    bedrooms = 0
    parking = 0
    bathrooms = 0
    property_type = "apartment"
    neighborhood = "Centro"
    street = ""
    
    h2_clean = raw['h2_text'].strip()
    final_neighborhood_found = False
    extraction_method = "Nenhum"

    # --- LÓGICA 1: Frase Descritiva (' em ') ---
    # Card: "Venda de casa em Jardim Campinas com 3 quartos."
    if " em " in h2_clean and any(x in h2_clean.lower() for x in ["venda", "aluguel", "comprar"]):
        
        # Pega tudo depois do " em " -> "Jardim Campinas com 3 quartos."
        raw_part = h2_clean.split(" em ")[-1]
        
        # Corta no " com ", " de ", parenteses ou ponto
        clean_part = re.split(r"(\sde\s\d|\scom\s|\s\(|\.$)", raw_part)[0]
        
        candidate = clean_neighborhood_name(clean_part)
        
        if is_valid_neighborhood(candidate):
            neighborhood = candidate
            final_neighborhood_found = True
            extraction_method = "Frase H2"
            
            # Specs do H2
            m_area = re.search(r"de\s+(\d+)\s*m²", h2_clean)
            if m_area: area = float(m_area.group(1))
            m_bed = re.search(r"(\d+)\s*quarto", h2_clean)
            if m_bed: bedrooms = int(m_bed.group(1))
            m_bath = re.search(r"(\d+)\s*banheiro", h2_clean)
            if m_bath: bathrooms = int(m_bath.group(1))
            m_park = re.search(r"(\d+)\s*vaga", h2_clean)
            if m_park: parking = int(m_park.group(1))
            property_type = normalize_property_type(h2_clean)

    # --- LÓGICA 2: Endereço Bruto no H2 (Correção Anterior) ---
    if not final_neighborhood_found and "-" in h2_clean and "campinas" in h2_clean.lower():
        if "," in h2_clean:
            last_chunk = h2_clean.split(",")[-1].strip()
            if "-" in last_chunk: candidate = last_chunk.split("-")[0].strip()
            else: candidate = last_chunk
            
            candidate = clean_neighborhood_name(candidate)
            if is_valid_neighborhood(candidate):
                neighborhood = candidate
                final_neighborhood_found = True
                extraction_method = "H2 Endereço Bruto"

    # --- LÓGICA 3: Fallback (Linhas) ---
    if not final_neighborhood_found:
        extraction_method = "Fallback Linhas"
        source_texts = []
        if raw['address_node_text']: source_texts.append(raw['address_node_text'])
        lines = raw['full_text'].split('\n')
        for line in lines:
            if ("·" in line or ("-" in line and "campinas" in line.lower())) and "m²" not in line: 
                source_texts.append(line)

        for text in source_texts:
            candidate = ""
            if "·" in text:
                parts = text.split('·')
                left_side = parts[0].strip()
                if "," in left_side: candidate = left_side.split(",")[-1].strip()
                else: candidate = left_side
            elif "-" in text:
                if "," in text: candidate = text.split(",")[-1].split("-")[0].strip()
                else: 
                    parts = text.split("-")
                    if len(parts) >= 3: candidate = parts[-2].strip()

            candidate = clean_neighborhood_name(candidate)
            if is_valid_neighborhood(candidate):
                neighborhood = candidate
                final_neighborhood_found = True
                print(f"   ✅ Bairro Válido via Fallback: '{neighborhood}' (Fonte: '{text}')")
                break
        
        # Specs Fallback
        for line in lines:
            l = line.lower()
            if "m²" in l and "quarto" in l:
                parts = l.split('·') if '·' in l else l.split(' ')
                for p in parts:
                    val = clean_number(p)
                    if "m²" in p: area = val
                    elif "quarto" in p: bedrooms = int(val)
                    elif "vaga" in p: parking = int(val)

    print(f"✅ Bairro Final: '{neighborhood}' (Método: {extraction_method})")
    
    # Título Final
    title = h2_clean if h2_clean and len(h2_clean) < 60 else f"{property_type} em {neighborhood}"

    # Preço Fallback
    if price == 0:
        for line in raw['full_text'].split('\n'):
            if "R$" in line and "condo" not in line.lower() and "iptu" not in line.lower():
                match = re.search(r"R\$\s*([\d\.]+)", line)
                if match:
                    price = clean_number(match.group(1))
                    break
            if "condo" in line.lower():
                match = re.search(r"R\$\s*([\d\.]+)", line)
                if match: condo = clean_number(match.group(1))

    return {
        "external_id": ext_id,
        "portal": "quintoandar",
        "url": full_url,
        "title": title,
        "price": price,
        "city": "Campinas",
        "state": "SP",
        "neighborhood": neighborhood,
        "street": street,
        "property_type": property_type,
        "area_m2": area,
        "bedrooms": bedrooms,
        "parking": parking,
        "bathrooms": bathrooms,
        "condo_fee": condo,
        "iptu": 0,
        "main_image_url": raw['img'],
        "images": [raw['img']] if raw['img'] else [],
        "is_active": True,
        "is_below_market": "Ótimo preço" in raw['full_text'],
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "published_at": datetime.now(timezone.utc).isoformat(),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        "full_data": {"h2_text": raw['h2_text'], "raw_text": raw['full_text']}
    }

# -----------------------------
# 4. Funções Auxiliares (Filtro, Data, etc)
# -----------------------------

async def force_filter_interaction(page):
    print("🛠️  Aplicando filtro 'Mais recentes'...")
    sort_btn = page.locator('div[role="button"], div[class*="Chip"]').filter(has_text=re.compile(r"Mais (recentes|relevantes)|Relevância")).first
    if await sort_btn.count() == 0:
         sort_btn = page.locator('div:has(svg):has-text("Mais")').first
    if await sort_btn.count() > 0:
        txt = await sort_btn.inner_text()
        if "recentes" in txt.lower(): return True
        await sort_btn.click()
        try:
            opt = page.locator('li, div[role="option"]').filter(has_text="Mais recentes").first
            await opt.wait_for(state="visible", timeout=5000)
            await opt.click(force=True)
            await asyncio.sleep(3)
            return True
        except: return False
    return False

async def click_load_more(page):
    btn = page.locator('button[data-testid="load-more-button"]')
    if await btn.count() > 0 and await btn.is_visible():
        try:
            await btn.scroll_into_view_if_needed()
            await btn.click()
            await asyncio.sleep(2)
            return True
        except: pass
    return False

async def get_details_date(context, card_element) -> str:
    page_detail = await context.new_page()
    try:
        href = await card_element.eval_on_selector("a", "el => el.href")
        await page_detail.goto(href)
        await page_detail.wait_for_load_state("domcontentloaded")
        try:
            loc = page_detail.locator('[data-testid="publication_date"]')
            await loc.wait_for(timeout=2500)
            text = await loc.inner_text()
            return text
        except: return ""
    except: return ""
    finally: await page_detail.close()

async def save_to_supabase(data):
    if not create_client or not data: return
    sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    try:
        sb.table("listings").upsert(data, on_conflict="portal,external_id").execute()
        print(f"💾 Salvou lote de {len(data)} imóveis.")
    except Exception as e:
        print(f"❌ Erro Supabase: {e}")

# -----------------------------
# 5. Execução (Batch Progressivo)
# -----------------------------

async def run_scan(headless: bool):
    print("🚀 Iniciando...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context(viewport={'width': 1366, 'height': 768})
        page = await context.new_page()
        
        await page.goto(BASE_URL, wait_until="domcontentloaded")
        await asyncio.sleep(3)
        try: await page.click('button:has-text("Aceitar")')
        except: pass
        await force_filter_interaction(page)
        
        card_selector = 'div[data-testid^="house-card-container"]'
        await page.wait_for_selector(card_selector, timeout=20000)

        # Lógica de Lotes (Igual a anterior, mas usando a nova extração)
        BATCH_SIZE = 10 
        base_index = 0
        stop_all = False
        
        while not stop_all:
            target_index_check = base_index + BATCH_SIZE - 1
            cards = await page.query_selector_all(card_selector)
            
            # Carregar mais se necessário
            retries = 0
            while len(cards) <= target_index_check:
                print(f"📜 Carregando... (Temos {len(cards)}, precisamos {target_index_check + 1})")
                clicked = await click_load_more(page)
                if not clicked: await page.mouse.wheel(0, 1000)
                await asyncio.sleep(2)
                new_cards = await page.query_selector_all(card_selector)
                if len(new_cards) == len(cards):
                    retries += 1
                    if retries >= 3:
                        target_index_check = len(new_cards) - 1
                        break
                else: retries = 0
                cards = new_cards

            if base_index >= len(cards): break

            check_idx = min(target_index_check, len(cards) - 1)
            print(f"🔍 Verificando lote {base_index}-{check_idx}...")
            
            # Verifica último do lote
            is_new = check_is_new(await get_details_date(context, cards[check_idx]))
            
            if is_new:
                print("✅ Lote NOVO. Salvando...")
                batch_data = []
                current_dom = await page.query_selector_all(card_selector) # Refresh DOM ref
                for i in range(base_index, check_idx + 1):
                    if i < len(current_dom):
                        batch_data.append(await extract_card_data(current_dom[i]))
                await save_to_supabase(batch_data)
                base_index += BATCH_SIZE
                if check_idx == len(cards) - 1: stop_all = True
            
            else:
                print("🛑 Lote MISTO/ANTIGO. Buscando corte...")
                low, high = base_index, check_idx
                cutoff = -1
                
                # Check primeiro
                if not check_is_new(await get_details_date(context, cards[low])):
                    cutoff = -1
                else:
                    while low + 1 < high:
                        mid = (low + high) // 2
                        if check_is_new(await get_details_date(context, cards[mid])):
                            low = mid
                        else: high = mid
                    cutoff = low
                
                if cutoff >= base_index:
                    print(f"💰 Salvando final (até {cutoff})...")
                    final_batch = []
                    current_dom = await page.query_selector_all(card_selector)
                    for i in range(base_index, cutoff + 1):
                        if i < len(current_dom):
                            final_batch.append(await extract_card_data(current_dom[i]))
                    await save_to_supabase(final_batch)
                
                stop_all = True

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_scan(headless=False))
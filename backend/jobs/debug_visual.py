import asyncio
import re
from playwright.async_api import async_playwright

async def force_filter_interaction(page):
    print("🛠️  Aplicando filtro 'Mais recentes'...")
    # Tenta achar botão de ordenação
    sort_btn = page.locator('div[role="button"], div[class*="Chip"]').filter(has_text=re.compile(r"Mais (recentes|relevantes)|Relevância")).first
    
    if await sort_btn.count() == 0:
         sort_btn = page.locator('div:has(svg):has-text("Mais")').first

    if await sort_btn.count() > 0:
        txt = await sort_btn.inner_text()
        print(f"ℹ️ Botão atual: {txt}")
        if "recentes" in txt.lower():
            print("✅ Filtro já está ativo.")
            return True
        
        await sort_btn.click()
        try:
            # Tenta clicar na opção
            opt = page.locator('li, div[role="option"]').filter(has_text="Mais recentes").first
            await opt.wait_for(state="visible", timeout=5000)
            await opt.click(force=True)
            print("⏳ Aguardando lista atualizar...")
            await asyncio.sleep(4)
            return True
        except Exception as e:
            print(f"❌ Erro no clique da opção: {e}")
            return False
    return False

async def debug_first_cards():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(viewport={'width': 1366, 'height': 768})
        page = await context.new_page()
        
        print("🌍 Acessando QuintoAndar...")
        await page.goto("https://www.quintoandar.com.br/comprar/imovel/campinas-sp-brasil", wait_until="domcontentloaded")
        await asyncio.sleep(3)
        
        # Fecha Cookies se aparecer
        try: await page.click('button:has-text("Aceitar")')
        except: pass

        # === APLICA O FILTRO ===
        await force_filter_interaction(page)
        # =======================
        
        print("⏳ Aguardando cards carregarem...")
        await page.wait_for_selector('div[data-testid^="house-card-container"]', timeout=20000)
        
        cards = page.locator('div[data-testid^="house-card-container"]')
        count = await cards.count()
        print(f"✅ Encontrados {count} cards. Analisando os 2 primeiros...")

        for i in range(min(2, count)):
            card = cards.nth(i)
            print(f"\n" + "="*50)
            print(f"🕵️  RAIO-X DO CARD {i} (Com Filtro Ativo)")
            print("="*50)

            structure = await card.evaluate("""(el) => {
                const getTxt = (tag) => el.querySelector(tag)?.innerText || "[NÃO EXISTE]";
                return {
                    h2_text: getTxt('h2'),
                    h3_text: getTxt('h3'),
                    all_text: el.innerText
                }
            }""")

            print(f"📌 [H2] Título:   '{structure['h2_text']}'")
            print(f"📌 [H3] Specs:    '{structure['h3_text']}'")
            print("-" * 20)
            print("📄 TEXTO VISÍVEL (Quebras de linha marcadas com | ):")
            print(structure['all_text'].replace('\n', ' | '))
            
            print("-" * 20)
            print("HTML DO TOPO (Para ver as tags reais):")
            html = await card.inner_html()
            # Imprime os primeiros 600 caracteres do HTML para vermos a estrutura
            print(html[:600])

        await browser.close()

if __name__ == "__main__":
    asyncio.run(debug_first_cards())
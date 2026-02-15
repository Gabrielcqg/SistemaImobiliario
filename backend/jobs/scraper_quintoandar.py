import asyncio
import os
import re
import sys
import zlib
from pathlib import Path
from datetime import datetime, timezone

from playwright.async_api import async_playwright

# -----------------------------
# 1) Configuração / ENV / LOG
# -----------------------------
ROOT_DIR = Path(__file__).resolve().parent              # /opt/scrapers/quintoandar
ENV_CANDIDATE_1 = ROOT_DIR.parent / ".env"              # /opt/scrapers/.env
ENV_CANDIDATE_2 = ROOT_DIR / ".env"                     # /opt/scrapers/quintoandar/.env

env_path = ENV_CANDIDATE_1 if ENV_CANDIDATE_1.exists() else ENV_CANDIDATE_2
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

NAV_TIMEOUT_MS = int(os.getenv("NAV_TIMEOUT_MS") or "25000")
DETAIL_TIMEOUT_MS = int(os.getenv("DETAIL_TIMEOUT_MS") or "15000")

HEADLESS = (os.getenv("HEADLESS") or "1").strip().lower() not in ("0", "false", "no")
BATCH_SIZE = int(os.getenv("BATCH_SIZE") or "10")
MAX_BATCHES = int(os.getenv("MAX_BATCHES") or "999999")

DEFAULT_UA = os.getenv("USER_AGENT") or (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
)

LOG_DIR = ROOT_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / f"quintoandar_{datetime.now().strftime('%Y-%m-%d')}.log"

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except:
        pass

async def dump_debug(page, label: str):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    prefix = LOG_DIR / f"debug_{label}_{ts}"

    try:
        await page.screenshot(path=str(prefix) + ".png", full_page=True)
        log(f"🧩 Screenshot: {prefix}.png")
    except Exception as e:
        log(f"⚠️ Falha ao tirar screenshot: {e}")

    try:
        html = await page.content()
        (Path(str(prefix) + ".html")).write_text(html, encoding="utf-8")
        log(f"🧩 HTML: {prefix}.html")

        low = html.lower()
        if any(x in low for x in ["cloudflare", "captcha", "verificando", "acesso negado", "blocked", "robot"]):
            log("🚫 Sinais de bloqueio/anti-bot detectados no HTML (cloudflare/captcha/blocked).")
    except Exception as e:
        log(f"⚠️ Falha ao salvar HTML: {e}")

    try:
        log(f"🧾 page.url = {page.url}")
        title = await page.title()
        log(f"🧾 page.title = {title}")
    except:
        pass

async def wait_for_cards(page, selectors: list[str], timeout_ms: int = 60000) -> str:
    """
    Espera aparecer algum seletor de card.
    Usa state='attached' (mais permissivo que 'visible') e faz scroll pra destravar lazy-load.
    Retorna o seletor vencedor.
    """
    start = asyncio.get_event_loop().time()
    last_scroll = 0

    while (asyncio.get_event_loop().time() - start) * 1000 < timeout_ms:
        for sel in selectors:
            try:
                await page.wait_for_selector(sel, timeout=1500, state="attached")
                if await page.locator(sel).count() > 0:
                    return sel
            except:
                pass

        now = asyncio.get_event_loop().time()
        if now - last_scroll > 1.2:
            last_scroll = now
            try:
                await page.mouse.wheel(0, 1600)
            except:
                pass
        await asyncio.sleep(0.2)

    raise TimeoutError("Nenhum seletor de card apareceu no tempo limite")

# -----------------------------
# 1.1) Property Types (CHECK)
# -----------------------------
def _get_allowed_property_types() -> set:
    raw = (os.getenv("LISTINGS_PROPERTY_TYPES") or "").strip()
    if not raw:
        return {"apartment", "house"}  # modo seguro
    return {x.strip().lower() for x in raw.split(",") if x.strip()}

ALLOWED_PROPERTY_TYPES = _get_allowed_property_types()

def _fallback_property_type(allowed: set) -> str:
    if "other" in allowed:
        return "other"
    if "apartment" in allowed:
        return "apartment"
    if "house" in allowed:
        return "house"
    return next(iter(allowed)) if allowed else "apartment"

FALLBACK_PROPERTY_TYPE = _fallback_property_type(ALLOWED_PROPERTY_TYPES)

# -----------------------------
# 2) Utils e Parsers
# -----------------------------
def extract_external_id(url: str) -> str:
    if not url:
        return "0"
    match = re.search(r"/imovel/(\d+)", url)
    if match:
        return match.group(1)
    return str(abs(zlib.adler32(url.encode("utf-8"))))

def normalize_property_type(text: str, allowed: set = None) -> str:
    allowed = allowed or ALLOWED_PROPERTY_TYPES
    fallback = _fallback_property_type(allowed)

    if not text:
        return fallback

    t = str(text).lower().strip()

    if any(k in t for k in ["studio", "kitnet", "loft", "flat"]):
        return "other" if "other" in allowed else fallback

    if any(k in t for k in ["casa", "sobrado"]):
        return "house" if "house" in allowed else fallback

    if "apart" in t:
        return "apartment" if "apartment" in allowed else fallback

    if any(k in t for k in ["lote", "terreno", "land"]):
        return "land" if "land" in allowed else fallback

    if any(k in t for k in ["comercial", "loja", "sala", "office"]):
        return "commercial" if "commercial" in allowed else fallback

    return "other" if "other" in allowed else fallback

def check_is_new(text_date: str) -> bool:
    if not text_date:
        return False
    return bool(re.search(r"(hora|minuto|segundo|agora|novo|hoje)", text_date.lower()))

def _build_quintoandar_image_url(value: str) -> str:
    if not value:
        return ""
    v = str(value).strip()
    if v.startswith("http://") or v.startswith("https://"):
        return v
    if v.startswith("/"):
        return "https://www.quintoandar.com.br" + v
    return "https://www.quintoandar.com.br/img/med/original" + v

def _fallback_neighborhood_from_dom(h2_text: str, full_text: str) -> str:
    h2 = (h2_text or "").strip()
    if " em " in h2:
        part = h2.split(" em ", 1)[-1]
        part = re.split(r"\scom\s|\sde\s|\(|\.", part)[0].strip()
        if part and len(part) >= 3:
            return part

    txt = full_text or ""
    m = re.search(r",\s*([^·\n,]{3,})\s*·\s*Campinas", txt, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()

    return ""

# -----------------------------
# 3) Listener da API (cache)
# -----------------------------
def attach_quintoandar_api_listener(page, api_by_id: dict):
    async def capture_response(response):
        try:
            ct = (response.headers.get("content-type") or "").lower()
            if "application/json" not in ct:
                return

            data = await response.json()
            hits = (data.get("hits") or {}).get("hits")
            if not isinstance(hits, list) or not hits:
                return

            for hit in hits:
                src = hit.get("_source") or {}
                listing_id = src.get("id") or hit.get("_id")
                if listing_id is None:
                    continue
                api_by_id[str(listing_id)] = src

        except Exception:
            return

    page.on("response", lambda resp: asyncio.create_task(capture_response(resp)))

# -----------------------------
# 4) Extração (API-first)
# -----------------------------
async def extract_card_data(card_element, api_by_id: dict) -> dict:
    # robusto: card pode ser <a> (fallback) ou container <div>
    raw = await card_element.evaluate(
        """(card) => {
            const link = (card.tagName === 'A') ? card : card.querySelector('a');
            const img = card.querySelector('img');
            const h2 = card.querySelector('h2');
            return {
                url: link ? (link.getAttribute('href') || link.href || "") : "",
                img: img ? (img.src || "") : "",
                h2_text: h2 ? (h2.innerText || "") : "",
                full_text: (card.innerText || "")
            }
        }"""
    )

    full_url = (
        "https://www.quintoandar.com.br" + raw["url"]
        if raw.get("url") and raw["url"].startswith("/")
        else (raw.get("url") or "")
    )
    ext_id = extract_external_id(full_url)

    src = api_by_id.get(str(ext_id))

    now_iso = datetime.now(timezone.utc).isoformat()
    title = (raw.get("h2_text") or "").strip() or f"imóvel {ext_id}"

    if not src:
        neighborhood = _fallback_neighborhood_from_dom(raw.get("h2_text"), raw.get("full_text"))
        raw_pt = raw.get("h2_text") or ""
        property_type = normalize_property_type(raw_pt)

        img0 = raw.get("img") or ""
        return {
            "external_id": str(ext_id),
            "portal": "quintoandar",
            "url": full_url,
            "title": title,
            "price": 0.0,
            "city": "Campinas",
            "state": "SP",
            "neighborhood": neighborhood,
            "street": "",
            "property_type": property_type,
            "area_m2": 0.0,
            "bedrooms": 0,
            "parking": 0,
            "bathrooms": 0,
            "condo_fee": 0.0,
            "iptu": 0.0,
            "main_image_url": img0,
            "images": [img0] if img0 else [],
            "is_active": True,
            "is_below_market": "Ótimo preço" in (raw.get("full_text") or ""),
            "scraped_at": now_iso,
            "published_at": now_iso,
            "last_seen_at": now_iso,
            "full_data": {
                "h2_text": raw.get("h2_text"),
                "raw_text": raw.get("full_text"),
                "api_source": None,
                "property_type_raw": raw_pt,
                "property_type_allowed": sorted(list(ALLOWED_PROPERTY_TYPES)),
            },
        }

    src_id = str(src.get("id") or ext_id)

    raw_pt = (src.get("type") or "")
    property_type = normalize_property_type(raw_pt)

    area = float(src.get("area") or 0)
    bathrooms = int(src.get("bathrooms") or 0)
    bedrooms = int(src.get("bedrooms") or 0)
    parking = int(src.get("parkingSpaces") or 0)

    street = (src.get("address") or "").strip()
    city = (src.get("city") or "Campinas").strip()

    neighborhood = (src.get("neighbourhood") or src.get("regionName") or "").strip()
    if not neighborhood:
        neighborhood = _fallback_neighborhood_from_dom(raw.get("h2_text"), raw.get("full_text"))

    price = float(src.get("salePrice") or src.get("rent") or 0)

    condo_fee = float(
        src.get("iptuPlusCondominium")
        or src.get("condominium")
        or src.get("condoFee")
        or 0
    )
    iptu = float(src.get("iptu") or 0)

    images = []
    if raw.get("img"):
        images.append(raw["img"])

    cover = _build_quintoandar_image_url(src.get("coverImage") or "")
    if cover:
        images.append(cover)

    image_list = src.get("imageList") or []
    if isinstance(image_list, list):
        for it in image_list:
            if isinstance(it, str) and it.strip():
                images.append(_build_quintoandar_image_url(it))
            elif isinstance(it, dict):
                u = it.get("url") or it.get("src") or it.get("path") or it.get("image")
                if u:
                    images.append(_build_quintoandar_image_url(u))

    seen = set()
    images = [x for x in images if x and (x not in seen and not seen.add(x))]

    main_image_url = raw.get("img") or (images[0] if images else "")

    if not title:
        title = f"{property_type} em {neighborhood or city}"

    return {
        "external_id": src_id,
        "portal": "quintoandar",
        "url": full_url,
        "title": title,
        "price": price,
        "city": city,
        "state": "SP",
        "neighborhood": neighborhood,
        "street": street,
        "property_type": property_type,
        "area_m2": area,
        "bedrooms": bedrooms,
        "parking": parking,
        "bathrooms": bathrooms,
        "condo_fee": condo_fee,
        "iptu": iptu,
        "main_image_url": main_image_url,
        "images": images,
        "is_active": True,
        "is_below_market": "Ótimo preço" in (raw.get("full_text") or ""),
        "scraped_at": now_iso,
        "published_at": now_iso,
        "last_seen_at": now_iso,
        "full_data": {
            "h2_text": raw.get("h2_text"),
            "raw_text": raw.get("full_text"),
            "api_source": src,
            "property_type_raw": raw_pt,
            "property_type_normalized": property_type,
            "property_type_allowed": sorted(list(ALLOWED_PROPERTY_TYPES)),
        },
    }

# -----------------------------
# 5) Funções Auxiliares
# -----------------------------
async def force_filter_interaction(page):
    log("🛠️  Aplicando filtro 'Mais recentes'...")
    sort_btn = (
        page.locator('div[role="button"], div[class*="Chip"]')
        .filter(has_text=re.compile(r"Mais (recentes|relevantes)|Relevância", re.IGNORECASE))
        .first
    )
    if await sort_btn.count() == 0:
        sort_btn = page.locator('div:has(svg):has-text("Mais")').first

    if await sort_btn.count() > 0:
        try:
            txt = await sort_btn.inner_text()
            if "recentes" in (txt or "").lower():
                return True

            await sort_btn.click()
            opt = page.locator('li, div[role="option"]').filter(
                has_text=re.compile("Mais recentes", re.IGNORECASE)
            ).first
            await opt.wait_for(state="visible", timeout=5000)
            await opt.click(force=True)
            await asyncio.sleep(2)
            return True
        except:
            return False
    return False

async def click_load_more(page):
    btn = page.locator('button[data-testid="load-more-button"]')
    if await btn.count() > 0 and await btn.is_visible():
        try:
            await btn.scroll_into_view_if_needed()
            await btn.click()
            await asyncio.sleep(1.5)
            return True
        except:
            pass
    return False

async def get_details_date(context, card_element, is_link_selector: bool) -> str:
    page_detail = await context.new_page()
    try:
        if is_link_selector:
            href = await card_element.evaluate("el => el.href")
        else:
            href = await card_element.eval_on_selector("a", "el => el.href")

        if not href:
            return ""

        await page_detail.goto(href, wait_until="domcontentloaded", timeout=DETAIL_TIMEOUT_MS)
        try:
            loc = page_detail.locator('[data-testid="publication_date"]')
            await loc.wait_for(timeout=2500)
            return (await loc.inner_text()) or ""
        except:
            return ""
    except:
        return ""
    finally:
        await page_detail.close()

def _looks_like_property_type_constraint_error(e: Exception) -> bool:
    s = str(e)
    return ("listings_property_type_check" in s) or ("violates check constraint" in s and "property_type" in s)

def _coerce_row_property_type(row: dict, force_fallback: bool = False) -> dict:
    if not row:
        return row

    allowed = ALLOWED_PROPERTY_TYPES
    fallback = _fallback_property_type(allowed)

    raw_pt = row.get("property_type") or ""
    normalized = normalize_property_type(raw_pt, allowed=allowed)

    if force_fallback:
        normalized = fallback

    if normalized not in allowed:
        normalized = fallback

    row["property_type"] = normalized
    return row

async def save_to_supabase(data):
    if not create_client or not data:
        return

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        log("⚠️ SUPABASE_URL/SUPABASE_KEY não encontrados no .env — pulando save.")
        return

    sb = create_client(url, key)

    data = [_coerce_row_property_type(row) for row in data]

    try:
        sb.table("listings").upsert(data, on_conflict="portal,external_id").execute()
        log(f"💾 Salvou lote de {len(data)} imóveis.")
        return

    except Exception as e:
        if _looks_like_property_type_constraint_error(e):
            log("⚠️ CHECK constraint em property_type. Fazendo fallback por item para não travar.")
            ok = 0
            fail = 0
            for row in data:
                try:
                    row = _coerce_row_property_type(row, force_fallback=True)
                    sb.table("listings").upsert([row], on_conflict="portal,external_id").execute()
                    ok += 1
                except Exception as e2:
                    fail += 1
                    log(f"❌ Falhou item external_id={row.get('external_id')} property_type={row.get('property_type')} err={e2}")
            log(f"💾 Salvou {ok} itens; {fail} falharam.")
            return

        log(f"❌ Erro Supabase: {e}")

# -----------------------------
# 6) Execução
# -----------------------------
def _chromium_args_for_server() -> list:
    if sys.platform.startswith("linux"):
        return [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote",
        ]
    return []

async def run_scan():
    log("🚀 Iniciando QuintoAndar...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=HEADLESS,
            args=_chromium_args_for_server(),
        )

        context = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            locale="pt-BR",
            user_agent=DEFAULT_UA,
        )
        page = await context.new_page()

        api_by_id = {}
        attach_quintoandar_api_listener(page, api_by_id)

        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=max(NAV_TIMEOUT_MS, 60000))
        await asyncio.sleep(2)

        # cookie banner (se existir)
        try:
            await page.click('button:has-text("Aceitar")', timeout=1500)
        except:
            pass

        await force_filter_interaction(page)

        # dá um tempo pro cache API preencher
        for _ in range(40):
            if api_by_id:
                break
            await asyncio.sleep(0.2)

        # tenta deixar a página estável
        try:
            await page.wait_for_load_state("networkidle", timeout=60000)
        except:
            pass

        # seletores com fallback (mais seguros)
        CARD_SELECTORS = [
            'div[data-testid^="house-card-container"]',
            'div[data-testid="house-card-container"]',
            # fallback mais filtrado (evita pegar anchors aleatórios do header/footer)
            'div:has(a[href*="/imovel/"]):has(img)',
            # último fallback: link direto (menos ideal, mas evita travar sem debug)
            'a[href*="/imovel/"]',
        ]

        try:
            card_selector = await wait_for_cards(page, CARD_SELECTORS, timeout_ms=90000)
            log(f"✅ Card selector escolhido: {card_selector}")
        except Exception as e:
            log(f"❌ Não encontrei cards: {e}")
            await dump_debug(page, "no_cards")
            raise

        is_link_selector = (card_selector == 'a[href*="/imovel/"]')

        base_index = 0
        stop_all = False
        batches = 0

        while not stop_all and batches < MAX_BATCHES:
            batches += 1
            target_index_check = base_index + BATCH_SIZE - 1

            cards = await page.query_selector_all(card_selector)

            retries = 0
            while len(cards) <= target_index_check:
                log(f"📜 Carregando... (Temos {len(cards)}, precisamos {target_index_check + 1})")
                clicked = await click_load_more(page)
                if not clicked:
                    await page.mouse.wheel(0, 1400)
                await asyncio.sleep(1.5)

                new_cards = await page.query_selector_all(card_selector)
                if len(new_cards) == len(cards):
                    retries += 1
                    if retries >= 3:
                        target_index_check = len(new_cards) - 1
                        break
                else:
                    retries = 0
                cards = new_cards

            if base_index >= len(cards):
                break

            check_idx = min(target_index_check, len(cards) - 1)
            log(f"🔍 Verificando lote {base_index}-{check_idx}...")

            text_date = await get_details_date(context, cards[check_idx], is_link_selector=is_link_selector)
            is_new = check_is_new(text_date)
            log(f"📅 publication_date idx={check_idx}: '{text_date}' -> is_new={is_new}")

            if is_new:
                log("✅ Lote NOVO. Salvando...")
                batch_data = []
                current_dom = await page.query_selector_all(card_selector)

                for i in range(base_index, check_idx + 1):
                    if i < len(current_dom):
                        batch_data.append(await extract_card_data(current_dom[i], api_by_id))

                await save_to_supabase(batch_data)

                base_index += BATCH_SIZE
                if check_idx == len(cards) - 1:
                    stop_all = True

            else:
                log("🛑 Lote MISTO/ANTIGO. Buscando corte...")
                low, high = base_index, check_idx
                cutoff = -1

                first_date = await get_details_date(context, cards[low], is_link_selector=is_link_selector)
                if not check_is_new(first_date):
                    cutoff = -1
                else:
                    while low + 1 < high:
                        mid = (low + high) // 2
                        mid_date = await get_details_date(context, cards[mid], is_link_selector=is_link_selector)
                        if check_is_new(mid_date):
                            low = mid
                        else:
                            high = mid
                    cutoff = low

                if cutoff >= base_index:
                    log(f"💾 Salvando final (até {cutoff})...")
                    final_batch = []
                    current_dom = await page.query_selector_all(card_selector)
                    for i in range(base_index, cutoff + 1):
                        if i < len(current_dom):
                            final_batch.append(await extract_card_data(current_dom[i], api_by_id))
                    await save_to_supabase(final_batch)

                stop_all = True

        await browser.close()
        log("✅ Finalizado.")

if __name__ == "__main__":
    asyncio.run(run_scan())

import asyncio
import os
import re
import random
import zlib
import unicodedata
import uuid
from pathlib import Path
from datetime import datetime, timezone

from playwright.async_api import async_playwright

# -----------------------------
# 1. Configuração
# -----------------------------
env_path = Path(__file__).resolve().parent.parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).resolve().parent / ".env"

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

# ✅ Opcional (recomendado): defina no .env para refletir o CHECK do banco, ex:
# LISTINGS_PROPERTY_TYPES=apartment,house,land,commercial,other
#
# Se não definir, por segurança assumimos só apartment/house (pra NÃO quebrar upsert).
def _get_allowed_property_types() -> set:
    raw = (os.getenv("LISTINGS_PROPERTY_TYPES") or "").strip()
    if not raw:
        return {"apartment", "house"}  # modo seguro
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


ALLOWED_PROPERTY_TYPES = _get_allowed_property_types()


def _fallback_property_type(allowed: set) -> str:
    # “Outros” só se existir no seu CHECK (ou se você colocar no .env)
    if "other" in allowed:
        return "other"
    if "apartment" in allowed:
        return "apartment"
    if "house" in allowed:
        return "house"
    # último fallback (nunca deveria acontecer)
    return next(iter(allowed)) if allowed else "apartment"


FALLBACK_PROPERTY_TYPE = _fallback_property_type(ALLOWED_PROPERTY_TYPES)

# ✅ DEDUPE KEY ------------------------------------------------------------
# Objetivo: sempre mandar dedupe_key (NOT NULL no banco), de forma determinística,
# estável em updates (não depende de preço), e com chance de casar cross-portal
# quando tiverem o mesmo endereço/bairro/cidade/área/quartos.
def _strip_accents(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def _norm_text(s: str) -> str:
    s = str(s or "").strip().lower()
    if not s:
        return ""
    s = _strip_accents(s)
    # remove pontuação e normaliza espaços
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _remove_numbers_tokens(s: str) -> str:
    # remove tokens com dígitos (nº, apto 12, 150, etc.) para facilitar match
    # (se isso te atrapalhar, é só comentar esta linha)
    s = re.sub(r"\b\w*\d\w*\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _bucket_area(area_m2) -> int:
    try:
        a = float(area_m2 or 0)
    except Exception:
        a = 0.0
    if a <= 0:
        return 0
    # bucket de 5m² (ex: 67 -> 65)
    return int(round(a / 5.0) * 5)


def build_dedupe_key(row: dict) -> str:
    # Preferimos rua/endereço, senão cai no título
    city = _norm_text(row.get("city") or "")
    state = _norm_text(row.get("state") or "")
    neighborhood = _norm_text(row.get("neighborhood") or "")

    street_raw = row.get("street") or ""
    title_raw = row.get("title") or ""
    base_raw = street_raw if _norm_text(street_raw) else title_raw

    base = _norm_text(base_raw)
    base = _remove_numbers_tokens(base)

    beds = int(row.get("bedrooms") or 0)
    area_bucket = _bucket_area(row.get("area_m2"))

    portal = _norm_text(row.get("portal") or "")
    ext = str(row.get("external_id") or "").strip()

    # Se não temos base suficiente, garantimos estabilidade por portal+external_id
    if len(base) < 6 and not neighborhood:
        key_str = f"homeradar|fallback|{portal}|{ext}"
    else:
        key_str = f"homeradar|{city}|{state}|{neighborhood}|{base}|b{beds}|a{area_bucket}"

    # UUID v5 determinístico (serve tanto se dedupe_key for UUID quanto TEXT)
    return str(uuid.uuid5(uuid.NAMESPACE_URL, key_str))


def ensure_dedupe_key(row: dict) -> dict:
    if not row:
        return row
    dk = row.get("dedupe_key")
    if dk and str(dk).strip():
        return row
    row["dedupe_key"] = build_dedupe_key(row)
    return row
# -------------------------------------------------------------------------


# -----------------------------
# 2. Utils e Parsers
# -----------------------------
def clean_number(text: str) -> float:
    if not text:
        return 0.0
    clean = re.sub(r"[^\d,]", "", text)
    clean = clean.replace(",", ".")
    try:
        return float(clean)
    except:
        return 0.0


def clean_int(text: str) -> int:
    if not text:
        return 0
    clean = re.sub(r"[^\d]", "", text)
    try:
        return int(clean)
    except:
        return 0


def extract_external_id(url: str) -> str:
    """
    Preferencialmente extrai /imovel/<id>.
    Se não achar, cria um id determinístico pela URL (evita random e duplicação).
    """
    if not url:
        return "0"
    match = re.search(r"/imovel/(\d+)", url)
    if match:
        return match.group(1)

    # fallback determinístico
    return str(abs(zlib.adler32(url.encode("utf-8"))))


def normalize_property_type(text: str, allowed: set = None) -> str:
    """
    ✅ IMPORTANTE: precisa bater com o CHECK CONSTRAINT do banco.
    - Nunca retorna algo fora de `allowed`
    - Se vier "studio" (como no seu erro), cai em "other" se existir, senão cai no fallback seguro.
    """
    allowed = allowed or ALLOWED_PROPERTY_TYPES
    fallback = _fallback_property_type(allowed)

    if not text:
        return fallback

    t = str(text).lower().strip()

    # --- Mapeamento (bruto -> canônico) ---
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
# 3. Listener da API (cache)
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
# 4. Extração (API-first)
# -----------------------------
async def extract_card_data(card_element, api_by_id: dict) -> dict:
    raw = await card_element.evaluate(
        """(card) => {
            const a = card.querySelector('a');
            const img = card.querySelector('img');
            const h2 = card.querySelector('h2');
            return {
                url: a ? a.getAttribute('href') : "",
                img: img ? img.src : "",
                h2_text: h2 ? h2.innerText : "",
                full_text: card.innerText || ""
            }
        }"""
    )

    full_url = (
        "https://www.quintoandar.com.br" + raw["url"]
        if raw["url"] and raw["url"].startswith("/")
        else (raw["url"] or "")
    )
    ext_id = extract_external_id(full_url)

    src = api_by_id.get(str(ext_id))

    now_iso = datetime.now(timezone.utc).isoformat()
    title = (raw.get("h2_text") or "").strip() or f"imóvel {ext_id}"

    # Fallback se ainda não capturou no cache
    if not src:
        neighborhood = _fallback_neighborhood_from_dom(raw.get("h2_text"), raw.get("full_text"))
        raw_pt = raw.get("h2_text") or ""
        property_type = normalize_property_type(raw_pt)

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
            "main_image_url": raw.get("img") or "",
            "images": [raw["img"]] if raw.get("img") else [],
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

    # -------- Map JSON -> schema --------
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
# 5. Funções Auxiliares (Filtro, Data, etc)
# -----------------------------
async def force_filter_interaction(page):
    print("🛠️  Aplicando filtro 'Mais recentes'...")
    sort_btn = (
        page.locator('div[role="button"], div[class*="Chip"]')
        .filter(has_text=re.compile(r"Mais (recentes|relevantes)|Relevância"))
        .first
    )
    if await sort_btn.count() == 0:
        sort_btn = page.locator('div:has(svg):has-text("Mais")').first

    if await sort_btn.count() > 0:
        txt = await sort_btn.inner_text()
        if "recentes" in txt.lower():
            return True

        await sort_btn.click()
        try:
            opt = page.locator('li, div[role="option"]').filter(has_text="Mais recentes").first
            await opt.wait_for(state="visible", timeout=5000)
            await opt.click(force=True)
            await asyncio.sleep(3)
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
            await asyncio.sleep(2)
            return True
        except:
            pass
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
        except:
            return ""
    except:
        return ""
    finally:
        await page_detail.close()


def _looks_like_property_type_constraint_error(e: Exception) -> bool:
    s = str(e)
    return ("listings_property_type_check" in s) or (
        "violates check constraint" in s and "property_type" in s
    )


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

    sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

    # 1) sempre “sanitiza” antes:
    #    - property_type (CHECK)
    #    - dedupe_key (NOT NULL)
    data2 = []
    for row in data:
        row = _coerce_row_property_type(row)
        row = ensure_dedupe_key(row)  # ✅ DEDUPE KEY
        data2.append(row)
    data = data2

    try:
        sb.table("listings").upsert(data, on_conflict="portal,external_id").execute()
        print(f"💾 Salvou lote de {len(data)} imóveis.")
        return

    except Exception as e:
        if _looks_like_property_type_constraint_error(e):
            print("⚠️ CHECK constraint em property_type. Fazendo fallback por item para não travar.")
            ok = 0
            fail = 0
            for row in data:
                try:
                    row = _coerce_row_property_type(row, force_fallback=True)
                    row = ensure_dedupe_key(row)  # ✅ DEDUPE KEY (redundância)
                    sb.table("listings").upsert([row], on_conflict="portal,external_id").execute()
                    ok += 1
                except Exception as e2:
                    fail += 1
                    print(
                        f"❌ Falhou item external_id={row.get('external_id')} "
                        f"property_type={row.get('property_type')} "
                        f"dedupe_key={row.get('dedupe_key')} err={e2}"
                    )
            print(f"💾 Salvou {ok} itens; {fail} falharam.")
            return

        print(f"❌ Erro Supabase: {e}")


# -----------------------------
# 6. Execução (Batch Progressivo)
# -----------------------------
async def run_scan(headless: bool):
    print("🚀 Iniciando...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context(viewport={"width": 1366, "height": 768})
        page = await context.new_page()

        api_by_id = {}
        attach_quintoandar_api_listener(page, api_by_id)

        await page.goto(BASE_URL, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        try:
            await page.click('button:has-text("Aceitar")')
        except:
            pass

        await force_filter_interaction(page)

        for _ in range(30):
            if api_by_id:
                break
            await asyncio.sleep(0.2)

        card_selector = 'div[data-testid^="house-card-container"]'
        await page.wait_for_selector(card_selector, timeout=20000)

        BATCH_SIZE = 10
        base_index = 0
        stop_all = False

        while not stop_all:
            target_index_check = base_index + BATCH_SIZE - 1
            cards = await page.query_selector_all(card_selector)

            retries = 0
            while len(cards) <= target_index_check:
                print(f"📜 Carregando... (Temos {len(cards)}, precisamos {target_index_check + 1})")
                clicked = await click_load_more(page)
                if not clicked:
                    await page.mouse.wheel(0, 1000)
                await asyncio.sleep(2)
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
            print(f"🔍 Verificando lote {base_index}-{check_idx}...")

            is_new = check_is_new(await get_details_date(context, cards[check_idx]))

            if is_new:
                print("✅ Lote NOVO. Salvando...")
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
                print("🛑 Lote MISTO/ANTIGO. Buscando corte...")
                low, high = base_index, check_idx
                cutoff = -1

                if not check_is_new(await get_details_date(context, cards[low])):
                    cutoff = -1
                else:
                    while low + 1 < high:
                        mid = (low + high) // 2
                        if check_is_new(await get_details_date(context, cards[mid])):
                            low = mid
                        else:
                            high = mid
                    cutoff = low

                if cutoff >= base_index:
                    print(f"💰 Salvando final (até {cutoff})...")
                    final_batch = []
                    current_dom = await page.query_selector_all(card_selector)
                    for i in range(base_index, cutoff + 1):
                        if i < len(current_dom):
                            final_batch.append(await extract_card_data(current_dom[i], api_by_id))
                    await save_to_supabase(final_batch)

                stop_all = True

        await browser.close()


if __name__ == "__main__":
    asyncio.run(run_scan(headless=True))

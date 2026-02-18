import asyncio
import os
import re
import zlib
import unicodedata
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, Tuple, List

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

# ============================================================
# 1) Configuração / ENV
# ============================================================
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

PORTAL_NAME = "quintoandar"
BASE_URL = "https://www.quintoandar.com.br/comprar/imovel/campinas-sp-brasil?ordering=creationDate-desc"

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


# ============================================================
# 2) Regras do banco e Utils
# ============================================================
def _get_allowed_property_types() -> set:
    raw = (os.getenv("LISTINGS_PROPERTY_TYPES") or "").strip()
    if not raw:
        return {"apartment", "house"}
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
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _remove_numbers_tokens(s: str) -> str:
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
    return int(round(a / 5.0) * 5)


def build_dedupe_key(row: dict) -> str:
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

    if len(base) < 6 and not neighborhood:
        key_str = f"homeradar|fallback|{portal}|{ext}"
    else:
        key_str = f"homeradar|{city}|{state}|{neighborhood}|{base}|b{beds}|a{area_bucket}"

    return str(uuid.uuid5(uuid.NAMESPACE_URL, key_str))


def ensure_dedupe_key(row: dict) -> dict:
    if not row:
        return row
    dk = row.get("dedupe_key")
    if dk and str(dk).strip():
        return row
    row["dedupe_key"] = build_dedupe_key(row)
    return row


# ============================================================
# 3) Debug helpers
# ============================================================
async def dump_debug(page, prefix: str):
    try:
        html_path = LOG_DIR / f"{prefix}_{_ts()}.html"
        png_path = LOG_DIR / f"{prefix}_{_ts()}.png"
        try:
            content = await page.content()
            html_path.write_text(content, encoding="utf-8", errors="ignore")
        except Exception:
            pass
        try:
            await page.screenshot(path=str(png_path), full_page=True, timeout=20000)
        except Exception:
            pass
        print(f"🧩 Debug salvo: {html_path}")
    except Exception:
        pass


def looks_like_blocked(html: str) -> bool:
    h = (html or "").lower()
    strong_signatures = [
        "cdn-cgi/challenge", "challenge-platform", "cf-challenge", "cf_turnstile",
        "turnstile", "hcaptcha", "g-recaptcha", "recaptcha",
        "checking your browser", "verificando seu navegador",
        "ddos protection", "just a moment", "ray id", "access denied",
    ]
    return any(sig in h for sig in strong_signatures)


async def goto_with_retry(page, url: str, wait_until: str = "domcontentloaded"):
    timeouts = [45000, 70000, 90000]
    last_err = None

    for i, to in enumerate(timeouts, start=1):
        try:
            print(f"🌐 Abrindo {url} (tentativa {i}/{len(timeouts)} timeout={to}ms)...")
            await page.goto(url, wait_until=wait_until, timeout=to)

            try:
                html = await page.content()
                if looks_like_blocked(html):
                    await dump_debug(page, "maybe_blocked_home")
                    print("⚠️ Possível challenge detectado, mas vou continuar e validar pelos cards...")
            except Exception:
                pass
            return
        except Exception as e:
            last_err = e
            if isinstance(e, PlaywrightTimeoutError) or "Timeout" in str(e):
                await dump_debug(page, "goto_timeout")
            if i < len(timeouts):
                await asyncio.sleep(1.0 * i)
                continue
            raise last_err


# ============================================================
# 5) Bloqueio de recursos pesados
# ============================================================
BLOCK_RESOURCE_TYPES = {"image", "media", "font"}
BLOCK_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".woff", ".woff2", ".ttf", ".otf",
    ".mp4", ".mp3", ".avi", ".mov", ".m4a",
)

async def setup_request_blocking(context):
    async def route_handler(route, request):
        try:
            rt = (request.resource_type or "").lower()
            url = (request.url or "").lower()
            base = url.split("?")[0]
            if rt in BLOCK_RESOURCE_TYPES:
                await route.abort()
                return
            if any(base.endswith(ext) for ext in BLOCK_EXTENSIONS):
                await route.abort()
                return
            await route.continue_()
        except Exception:
            try:
                await route.continue_()
            except Exception:
                pass
    await context.route("**/*", route_handler)


# ============================================================
# 6) Normalizações
# ============================================================
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

    # --- CORREÇÃO AQUI ---
    # Adicionamos os termos em inglês (house, home) para caso o valor já esteja normalizado
    
    if any(k in t for k in ["studio", "kitnet", "loft", "flat"]):
        return "other" if "other" in allowed else fallback
        
    # Adicionado "house" e "home" na lista abaixo
    if any(k in t for k in ["casa", "sobrado", "house", "home"]): 
        return "house" if "house" in allowed else fallback
        
    # Adicionado "apartment" na lista (embora "apart" já pegasse, é bom garantir)
    if any(k in t for k in ["apart", "apto", "flat"]): 
        return "apartment" if "apartment" in allowed else fallback
        
    if any(k in t for k in ["lote", "terreno", "land", "plot"]):
        return "land" if "land" in allowed else fallback
        
    if any(k in t for k in ["comercial", "loja", "sala", "office", "commercial"]):
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
    if v.startswith("http"):
        return v
    if v.startswith("/"):
        return "https://www.quintoandar.com.br" + v
    if v.startswith("original"):
        return f"https://www.quintoandar.com.br/img/med/{v}"
    if "-" in v or "_" in v:
         return f"https://www.quintoandar.com.br/img/med/{v}"
    return f"https://www.quintoandar.com.br/img/med/original{v}"


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


# ============================================================
# 7) Listener da API (cache)
# ============================================================
def attach_quintoandar_api_listener(page, api_by_id: dict):
    async def capture_response(response):
        try:
            ct = (response.headers.get("content-type") or "").lower()
            if "application/json" not in ct:
                return
            try:
                data = await response.json()
            except Exception:
                return
            hits = (data.get("hits") or {}).get("hits")
            if not isinstance(hits, list) or not hits:
                return
            for hit in hits:
                src = hit.get("_source")
                if not src:
                    continue
                listing_id = src.get("id") or hit.get("_id")
                if listing_id is None:
                    continue
                has_price = (src.get("salePrice") is not None) or (src.get("rent") is not None)
                has_images = (src.get("coverImage") is not None)
                if has_price or has_images:
                    api_by_id[str(listing_id)] = src
        except Exception:
            return
    page.on("response", lambda resp: asyncio.create_task(capture_response(resp)))


# ============================================================
# 8) Extração (API-first) + imagens via API
# ============================================================
def _minimize_api_source(src: dict) -> dict:
    if not isinstance(src, dict):
        return {}
    keep = [
        "id", "type", "area", "bathrooms", "bedrooms", "parkingSpaces",
        "address", "city", "state", "neighbourhood", "regionName",
        "salePrice", "rent", "iptu", "condominium", "condoFee", "iptuPlusCondominium",
        "coverImage", "imageList",
    ]
    return {k: src.get(k) for k in keep if k in src}


async def extract_card_data(card_element, api_by_id: dict) -> dict:
    raw = await card_element.evaluate(
        """(card) => {
            const a = card.querySelector('a');
            const h2 = card.querySelector('h2');
            return {
                url: a ? a.getAttribute('href') : "",
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

    # -------------------------------------------
    # Fallback sem src
    # -------------------------------------------
    if not src:
        neighborhood = _fallback_neighborhood_from_dom(raw.get("h2_text"), raw.get("full_text"))
        raw_pt = raw.get("h2_text") or ""
        property_type = normalize_property_type(raw_pt)
        row = {
            "external_id": str(ext_id),
            "portal": PORTAL_NAME,
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
            "main_image_url": "",
            "images": [],
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
        row = _coerce_row_property_type(row)
        row = ensure_dedupe_key(row)
        return row

    # -------------------------------------------
    # Com src (API)
    # -------------------------------------------
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

    images: List[str] = []
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
    main_image_url = images[0] if images else ""

    row = {
        "external_id": src_id,
        "portal": PORTAL_NAME,
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
            "api_source": _minimize_api_source(src),
            "property_type_raw": raw_pt,
            "property_type_normalized": property_type,
            "property_type_allowed": sorted(list(ALLOWED_PROPERTY_TYPES)),
        },
    }
    row = _coerce_row_property_type(row)
    row = ensure_dedupe_key(row)
    return row


# ============================================================
# 9) UI Helpers
# ============================================================
async def _dismiss_popups(page):
    candidates = [
        'button:has-text("Aceitar")',
        'button:has-text("Concordo")',
        'button:has-text("Entendi")',
        'button:has-text("Fechar")',
        '[aria-label="Fechar"]',
        '[aria-label="Close"]',
        'button[aria-label="Close"]',
    ]
    for sel in candidates:
        loc = page.locator(sel).first
        try:
            if await loc.count() > 0 and await loc.is_visible():
                await loc.click(timeout=2000, force=True, no_wait_after=True)
                await page.wait_for_timeout(250)
        except Exception:
            pass


async def force_filter_interaction(page):
    print("🛠️  Verificando filtros de ordenação...")
    await _dismiss_popups(page)
    patterns = [
        re.compile(r"^Mais relevantes$", re.I),
        re.compile(r"^Relevância$", re.I),
        re.compile(r"^Mais recentes$", re.I),
        re.compile(r"^Ordenar por", re.I),
    ]
    target = None
    for p in patterns:
        candidates = page.get_by_text(p)
        count = await candidates.count()
        for i in range(count):
            loc = candidates.nth(i)
            if await loc.is_visible():
                txt = (await loc.inner_text()).strip()
                if 0 < len(txt) < 40:
                    target = loc
                    break
        if target: break
    if not target:
        possible_dropdown = page.locator('div[class*="Dropdown-control"]').first
        if await possible_dropdown.count() > 0 and await possible_dropdown.is_visible():
            txt = (await possible_dropdown.inner_text()).strip()
            if len(txt) < 40:
                target = possible_dropdown
    if not target:
        print("⚠️ Botão de filtro não encontrado.")
        return False
    found_text = (await target.inner_text()).strip()
    print(f"ℹ️  Botão identificado: '{found_text}'")
    if "recentes" in found_text.lower():
        print("✅ Já está em 'Mais recentes'.")
        return True
    try:
        await target.click(force=True)
    except Exception:
        return False
    await page.wait_for_timeout(1000)
    option = page.get_by_text("Mais recentes", exact=True).first
    if await option.count() == 0:
        option = page.locator('div[role="option"], li').filter(has_text=re.compile(r"^Mais recentes", re.I)).first
    if await option.count() > 0 and await option.is_visible():
        await option.click(force=True)
        print("✅ Selecionado 'Mais recentes'.")
        await page.wait_for_timeout(4000)
        return True
    return False


# ============================================================
# 10) Checagem "publicado hoje"
# ============================================================
async def _get_card_href_and_text(card_element) -> Tuple[str, str]:
    data = await card_element.evaluate(
        """(card) => {
            const a = card.querySelector('a');
            return { href: a ? a.href : "", txt: card.innerText || "" }
        }"""
    )
    return (data.get("href") or ""), (data.get("txt") or "")


async def get_publication_text_cached(detail_page, external_id: str, href: str, pub_cache: dict) -> str:
    if external_id in pub_cache:
        return pub_cache[external_id] or ""
    if not href:
        pub_cache[external_id] = ""
        return ""
    try:
        await detail_page.goto(href, wait_until="domcontentloaded", timeout=60000)
        loc = detail_page.locator('[data-testid="publication_date"]')
        try:
            await loc.wait_for(timeout=3000)
            text = await loc.inner_text()
        except Exception:
            text = ""
        pub_cache[external_id] = text or ""
        return pub_cache[external_id]
    except Exception:
        pub_cache[external_id] = ""
        return ""


async def is_card_new_today(card_element, detail_page, pub_cache: dict) -> bool:
    href, txt = await _get_card_href_and_text(card_element)
    ext_id = extract_external_id(href)
    if check_is_new(txt):
        return True
    pub_text = await get_publication_text_cached(detail_page, ext_id, href, pub_cache)
    return check_is_new(pub_text)


# ============================================================
# 11) Supabase (client único + retry)
# ============================================================
def _is_transient_error(e: Exception) -> bool:
    s = str(e).lower()
    transient = ["timeout", "timed out", "connection", "reset", "502", "503", "504", "too many requests", "rate limit"]
    return any(t in s for t in transient)


async def upsert_with_retry(sb, rows: list, on_conflict: str, max_attempts: int = 4):
    delay = 1.5
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            # ✅ AJUSTE CRÍTICO: ignore_duplicates=False para forçar UPDATE
            result = sb.table("listings").upsert(
                rows, 
                on_conflict=on_conflict, 
                ignore_duplicates=False
            ).execute()
            return result
        except Exception as e:
            last_err = e
            if attempt >= max_attempts or not _is_transient_error(e):
                raise
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10.0)
    if last_err:
        raise last_err
    return None


async def click_load_more(page):
    btn = page.locator('button[data-testid="load-more-button"]').first
    if await btn.count() == 0:
        btn = page.locator("button").filter(has_text=re.compile(r"Ver mais|Carregar mais", re.I)).first
    if await btn.count() > 0 and await btn.is_visible():
        try:
            await btn.scroll_into_view_if_needed()
            await btn.click(timeout=3000, force=True, no_wait_after=True)
            await page.wait_for_timeout(1000)
            return True
        except Exception:
            pass
    return False


def _chunked(seq: List[str], size: int = 150) -> List[List[str]]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def drop_published_at_for_existing(sb, rows: list) -> list:
    if not sb or not rows:
        return rows
    candidates = []
    for r in rows:
        if not isinstance(r, dict): continue
        portal = (r.get("portal") or "").strip()
        ext = r.get("external_id")
        if portal and ext is not None and "published_at" in r:
            candidates.append((portal, str(ext)))
    if not candidates:
        return rows
    by_portal: Dict[str, List[str]] = {}
    for portal, ext in candidates:
        by_portal.setdefault(portal, []).append(ext)
    existing_with_published = set()
    try:
        for portal, ids in by_portal.items():
            ids = list({str(x) for x in ids if x})
            if not ids: continue
            for chunk in _chunked(ids, size=150):
                resp = sb.table("listings").select("external_id,published_at").eq("portal", portal).in_("external_id", chunk).execute()
                data = getattr(resp, "data", None) or []
                for item in data:
                    ext_id = str(item.get("external_id"))
                    pub = item.get("published_at")
                    if pub is not None:
                        existing_with_published.add((portal, ext_id))
    except Exception:
        return rows
    for r in rows:
        if not isinstance(r, dict): continue
        portal = (r.get("portal") or "").strip()
        ext = r.get("external_id")
        if portal and ext is not None:
            key = (portal, str(ext))
            if key in existing_with_published:
                r.pop("published_at", None)
    return rows


async def save_to_supabase(sb, data):
    if not create_client or not data or not sb:
        return

    out = []
    for row in data:
        row = _coerce_row_property_type(row)
        row = ensure_dedupe_key(row)
        out.append(row)
    data = out
    data = drop_published_at_for_existing(sb, data)

    try:
        response = await upsert_with_retry(sb, data, on_conflict="portal,external_id")
        
        count = 0
        if response and hasattr(response, 'data') and response.data:
            count = len(response.data)
            
        print(f"💾 Salvou lote de {len(data)} imóveis. (Supabase confirmou: {count} registros processados)")

        return

    except Exception as e:
        if _looks_like_property_type_constraint_error(e):
            print("⚠️ CHECK constraint em property_type. Fazendo fallback...")
            ok = 0
            fail = 0
            for row in data:
                try:
                    row = _coerce_row_property_type(row, force_fallback=True)
                    row = ensure_dedupe_key(row)
                    _row_list = drop_published_at_for_existing(sb, [row])
                    row = _row_list[0] if _row_list else row
                    await upsert_with_retry(sb, [row], on_conflict="portal,external_id")
                    ok += 1
                except Exception as e2:
                    fail += 1
                    print(f"❌ Falhou item external_id={row.get('external_id')} err={e2}")
            print(f"💾 Salvou {ok} itens via fallback; {fail} falharam.")
            return
        print(f"❌ Erro Supabase: {e}")


# ============================================================
# 12) Execução principal
# ============================================================
async def run_scan(headless: bool):
    print("🚀 Iniciando...")
    async with async_playwright() as p:
        chromium_args = ["--disable-dev-shm-usage"]
        if (os.getenv("PLAYWRIGHT_NO_SANDBOX") or "").strip() == "1":
            chromium_args += ["--no-sandbox"]

        browser = await p.chromium.launch(headless=headless, args=chromium_args)
        context = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        )
        await setup_request_blocking(context)

        page = await context.new_page()
        detail_page = await context.new_page()
        page.set_default_timeout(15000)
        page.set_default_navigation_timeout(90000)
        detail_page.set_default_timeout(15000)
        detail_page.set_default_navigation_timeout(90000)

        api_by_id: Dict[str, Any] = {}
        attach_quintoandar_api_listener(page, api_by_id)

        await goto_with_retry(page, BASE_URL, wait_until="domcontentloaded")

        try:
            print("⏳ Aguardando renderização inicial...")
            await page.wait_for_selector(
                'div[data-testid^="house-card-container"], div[data-testid="map-container"]',
                timeout=30000,
            )
        except Exception:
            print("⚠️ Timeout esperando a lista carregar.")

        await _dismiss_popups(page)
        ok_sort = await force_filter_interaction(page)
        if not ok_sort:
            print("⚠️ Não consegui confirmar filtro 'Mais recentes'.")

        for _ in range(40):
            if api_by_id: break
            await page.wait_for_timeout(120)

        card_selector = 'div[data-testid^="house-card-container"]'
        try:
            await page.wait_for_selector(card_selector, timeout=35000)
        except Exception:
            await dump_debug(page, "no_cards_after_goto")
            raise

        sb = None
        sb_url = os.getenv("SUPABASE_URL")
        
        # Tenta pegar a SERVICE_ROLE (Admin) primeiro. 
        # Se não existir no .env, tenta usar a SUPABASE_KEY normal.
        sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

        if create_client and sb_url and sb_key:
            # Pequeno log para você saber qual chave está sendo usada
            key_type = "SERVICE_ROLE (ADMIN)" if os.getenv("SUPABASE_SERVICE_ROLE_KEY") else "ANON (PUBLICA)"
            print(f"🔌 Conectando ao Supabase via {key_type}...")
            
            try:
                sb = create_client(sb_url, sb_key)
            except Exception as e:
                print(f"❌ Erro ao inicializar cliente Supabase: {e}")
                sb = None
        else:
            print("⚠️ Supabase não configurado (Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env).")

        pub_cache: Dict[str, str] = {}
        BATCH_SIZE = 10
        base_index = 0
        stop_all = False

        while not stop_all:
            cards = await page.query_selector_all(card_selector)
            target_index_check = base_index + BATCH_SIZE - 1

            retries = 0
            while len(cards) <= target_index_check:
                print(f"📜 Carregando... (Temos {len(cards)}, precisamos {target_index_check + 1})")
                clicked = await click_load_more(page)
                if not clicked:
                    await page.mouse.wheel(0, 1200)
                    await page.wait_for_timeout(500)
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

            is_new = await is_card_new_today(cards[check_idx], detail_page, pub_cache)

            if is_new:
                print("✅ Lote NOVO. Salvando...")
                batch_data = []
                for i in range(base_index, check_idx + 1):
                    if i < len(cards):
                        batch_data.append(await extract_card_data(cards[i], api_by_id))
                if sb:
                    await save_to_supabase(sb, batch_data)
                base_index += BATCH_SIZE
                if check_idx == len(cards) - 1:
                    stop_all = True
            else:
                print("🛑 Lote MISTO/ANTIGO. Buscando corte...")
                low, high = base_index, check_idx
                cutoff = -1
                if not await is_card_new_today(cards[low], detail_page, pub_cache):
                    cutoff = -1
                else:
                    while low + 1 < high:
                        mid = (low + high) // 2
                        if await is_card_new_today(cards[mid], detail_page, pub_cache):
                            low = mid
                        else:
                            high = mid
                    cutoff = low

                if cutoff >= base_index:
                    print(f"💾 Salvando final (até {cutoff})...")
                    final_batch = []
                    for i in range(base_index, cutoff + 1):
                        if i < len(cards):
                            final_batch.append(await extract_card_data(cards[i], api_by_id))
                    if sb:
                        await save_to_supabase(sb, final_batch)
                stop_all = True

        try:
            await detail_page.close()
        except Exception:
            pass
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_scan(headless=True))
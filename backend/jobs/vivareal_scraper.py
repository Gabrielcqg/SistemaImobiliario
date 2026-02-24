import os
import json
import re
import time
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlparse, parse_qs
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv("/opt/scrapers/.env")
load_dotenv("/opt/scrapers/vivareal/.env")
load_dotenv()

TZ = ZoneInfo("America/Sao_Paulo")
PORTAL = "vivareal"


def env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default)).strip().lower() in ("1", "true", "yes", "y", "on")


DRY_RUN = env_flag("DRY_RUN", "0")
RUN_ONCE = env_flag("RUN_ONCE", "0")
SLEEP_SECONDS = int(os.getenv("SLEEP_SECONDS", "180"))
RECENT_HOURS = int(os.getenv("RECENT_HOURS", "32"))
FLUSH_OUTBOX_EVERY_SECONDS = int(os.getenv("FLUSH_OUTBOX_EVERY_SECONDS", "3600"))

OUTBOX_DIR = Path(os.getenv("OUTBOX_DIR", "/opt/scrapers/outbox"))
OUTBOX_DIR.mkdir(parents=True, exist_ok=True)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_KEY_LEGACY = os.getenv("SUPABASE_KEY")

SUPABASE_READ_KEY = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY or SUPABASE_KEY_LEGACY
SUPABASE_WRITE_KEY = SUPABASE_SERVICE_ROLE_KEY
SUPABASE_WRITE_KEY_MODE = "service_role" if SUPABASE_SERVICE_ROLE_KEY else ("anon" if (SUPABASE_ANON_KEY or SUPABASE_KEY_LEGACY) else "missing")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL ausente no ambiente")

if not SUPABASE_READ_KEY and not DRY_RUN:
    raise RuntimeError("Nenhuma chave Supabase encontrada. Configure SUPABASE_SERVICE_ROLE_KEY")

supabase_read: Client | None = create_client(SUPABASE_URL, SUPABASE_READ_KEY) if SUPABASE_READ_KEY else None
supabase_write: Client | None = create_client(SUPABASE_URL, SUPABASE_WRITE_KEY) if SUPABASE_WRITE_KEY else None

if not DRY_RUN and supabase_write is None:
    print(
        "ERRO CRITICO: SEM SERVICE ROLE KEY: escrita no Supabase fica bloqueada por RLS. "
        "Configure SUPABASE_SERVICE_ROLE_KEY. Entrando em modo outbox para evitar perda silenciosa.",
        flush=True,
    )

URL = "https://glue-api.vivareal.com/v4/listings?user=aeaa0c71-4ec4-4d43-a17a-84e5acac5e45&portal=VIVAREAL&includeFields=fullUriFragments%2Cpage%2Csearch%28result%28listings%28listing%28expansionType%2CcontractType%2ClistingsCount%2CpropertyDevelopers%2CsourceId%2CdisplayAddressType%2Camenities%2CusableAreas%2CconstructionStatus%2ClistingType%2Cdescription%2Ctitle%2Cstamps%2CcreatedAt%2Cfloors%2CunitTypes%2CnonActivationReason%2CproviderId%2CpropertyType%2CunitSubTypes%2CunitsOnTheFloor%2ClegacyId%2Cid%2Cportal%2Cportals%2CunitFloor%2CparkingSpaces%2CupdatedAt%2Caddress%2Csuites%2CpublicationType%2CexternalId%2Cbathrooms%2CusageTypes%2CtotalAreas%2CadvertiserId%2CadvertiserContact%2CwhatsappNumber%2Cbedrooms%2CacceptExchange%2CpricingInfos%2CshowPrice%2Cresale%2Cbuildings%2CcapacityLimit%2Cstatus%2CpriceSuggestion%2CcondominiumName%2Cmodality%2CenhancedDevelopment%29%2Caccount%28id%2Cname%2ClogoUrl%2ClicenseNumber%2CshowAddress%2ClegacyVivarealId%2ClegacyZapId%2CcreatedDate%2Ctier%2CtrustScore%2CtotalCountByFilter%2CtotalCountByAdvertiser%29%2Cmedias%2CaccountLink%2Clink%2Cchildren%28id%2CusableAreas%2CtotalAreas%2Cbedrooms%2Cbathrooms%2CparkingSpaces%2CpricingInfos%29%29%29%2CtotalCount%29&categoryPage=RESULT&business=SALE&sort=MOST_RECENT&parentId=null&listingType=USED&__zt=mtc%3Adeduplication2023&addressCity=Campinas&addressLocationId=BR%3ESao+Paulo%3ENULL%3ECampinas&addressState=S%C3%A3o+Paulo&addressPointLat=-22.905082&addressPointLon=-47.061333&addressType=city&page=1&size=50&from=0&images=webp"


def infer_target_business_type(url: str, default: str = "SALE") -> str:
    try:
        query = parse_qs(urlparse(url).query or "")
        value = (query.get("business") or [default])[0]
        norm = str(value or default).strip().upper()
        return norm or default
    except Exception:
        return default


TARGET_BUSINESS_TYPE = str(
    os.getenv("TARGET_BUSINESS_TYPE", infer_target_business_type(URL, "SALE"))
).strip().upper() or "SALE"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    "x-domain": ".vivareal.com.br",
    "Referer": "https://www.vivareal.com.br/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

PRINT_FULL_REQUEST_URL_ON_START = True
SAMPLE_N = int(os.getenv("SAMPLE_N", "10"))

SCRAPE_LOGS_ALLOWED_FIELDS = {
    "run_id",
    "portal",
    "status_code",
    "duration_ms",
    "bytes_received",
    "cards_collected",
    "cards_upserted",
    "render_used",
    "error_msg",
}

OUTBOX_PREFIX = "vivareal_failed_"
_OUTBOX_STATE_DAY: str | None = None
_OUTBOX_STATE_SEEN: set[str] = set()
_LAST_OUTBOX_FLUSH_TS = 0.0


def now_sp() -> datetime:
    return datetime.now(TZ)


def parse_iso(dt_str: str):
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None


def _norm_business_type(value: str | None) -> str:
    return str(value or "").strip().upper()


def _business_aliases(target: str) -> set[str]:
    target = _norm_business_type(target)
    aliases = {
        "SALE": {"SALE", "SELL", "FOR_SALE"},
        "RENTAL": {"RENTAL", "RENT", "FOR_RENT", "LEASE"},
    }
    return aliases.get(target, {target})


def select_pricing_info(listing: dict, preferred_business: str) -> tuple[dict, str]:
    infos = [x for x in (listing.get("pricingInfos") or []) if isinstance(x, dict)]
    if not infos:
        return {}, ""

    allowed = _business_aliases(preferred_business)
    for info in infos:
        bt = _norm_business_type(info.get("businessType"))
        if bt in allowed and info.get("price") is not None:
            return info, bt

    for info in infos:
        bt = _norm_business_type(info.get("businessType"))
        if bt in allowed:
            return info, bt

    for info in infos:
        if info.get("price") is not None:
            return info, _norm_business_type(info.get("businessType"))

    first = infos[0]
    return first, _norm_business_type(first.get("businessType"))


def pick_pricing_value(pricing_infos: list[dict], selected: dict, field: str):
    if isinstance(selected, dict) and selected.get(field) is not None:
        return selected.get(field)
    for info in pricing_infos:
        if isinstance(info, dict) and info.get(field) is not None:
            return info.get(field)
    return None


def to_float_safe(x):
    if x is None:
        return None
    try:
        if isinstance(x, (int, float)):
            return float(x)
        s = str(x).strip()
        if not s:
            return None
        s = s.replace("R$", "").replace(" ", "")
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", ".")
        return float(s)
    except Exception:
        return None


def get_normalized_type(unit_types: list) -> str:
    if not unit_types or not isinstance(unit_types, list):
        return "other"

    raw = str(unit_types[0]).upper().strip()

    if raw == "HOME":
        return "house"
    if raw == "CONDOMINIUM":
        return "house"
    if raw == "APARTMENT":
        return "apartment"
    if "COMMERCIAL" in raw:
        return "commercial"

    return "other"


def build_card_url(item: dict, ext_id: str) -> str:
    if not isinstance(item, dict):
        return f"https://www.vivareal.com.br/imovel/{ext_id}"

    listing = item.get("listing", {}) or {}

    for obj in (item.get("link"), listing.get("link")):
        if isinstance(obj, dict):
            href = obj.get("href") or obj.get("url") or obj.get("uri")
            if isinstance(href, str) and href:
                if href.startswith("/"):
                    return "https://www.vivareal.com.br" + href
                if href.startswith("http"):
                    return href

    fuf = item.get("fullUriFragments") or listing.get("fullUriFragments")
    if isinstance(fuf, str) and fuf.strip():
        frag = fuf.strip()
        if frag.startswith("/"):
            return "https://www.vivareal.com.br" + frag
        if frag.startswith("http"):
            return frag
    if isinstance(fuf, list) and fuf:
        for frag in fuf:
            if isinstance(frag, str) and frag.strip():
                frag = frag.strip()
                if frag.startswith("/"):
                    return "https://www.vivareal.com.br" + frag
                if frag.startswith("http"):
                    return frag

    return f"https://www.vivareal.com.br/imovel/{ext_id}"


def detect_below_market(listing: dict):
    stamps = listing.get("stamps") or []
    if not isinstance(stamps, list):
        stamps = []

    for item in stamps:
        if isinstance(item, str):
            up = item.upper()
            if any(flag in up for flag in ["BELOW", "UNDER", "ABAIXO", "LOW_PRICE", "UNDER_MARKET"]):
                return True, f"stamp:{item}"

    ps = listing.get("priceSuggestion")
    if isinstance(ps, dict) and ps:
        for key in ("belowMarket", "isBelowMarket", "underMarket", "priceBelowMarket", "below_market"):
            if ps.get(key) is True:
                return True, f"priceSuggestion.{key}=true"

        status = ps.get("status") or ps.get("classification") or ps.get("label") or ps.get("tag")
        if isinstance(status, str):
            sup = status.upper()
            if any(flag in sup for flag in ["BELOW", "ABAIXO", "UNDER"]):
                return True, f"priceSuggestion.status:{status}"

    return False, None


def summarize_price_suggestion(ps):
    if not isinstance(ps, dict) or not ps:
        return None
    keys = list(ps.keys())
    return {
        "keys": keys[:8],
        "status": ps.get("status") or ps.get("classification") or ps.get("label"),
    }


def extract_main_image_url(item: dict) -> str | None:
    try:
        medias = item.get("medias", []) or []
        if not isinstance(medias, list):
            medias = []

        for media in medias:
            if not isinstance(media, dict):
                continue
            raw_url = (media.get("url") or "") or ""
            media_type = (media.get("type") or "") or ""

            if media_type == "IMAGE" and raw_url and ("youtube" not in raw_url.lower()) and ("youtu.be" not in raw_url.lower()):
                return (
                    raw_url.replace("{description}", "imovel")
                    .replace("{action}", "crop")
                    .replace("{width}", "800")
                    .replace("{height}", "600")
                )

        for media in medias:
            if isinstance(media, dict):
                for key in ("url", "src", "link", "href"):
                    value = media.get(key)
                    if isinstance(value, str) and value.startswith("http"):
                        return value
        return None
    except Exception:
        return None


def should_update(existing_row: dict, new_price_val, new_image_url: str | None, new_updated_at_portal: str | None) -> bool:
    if not existing_row:
        return True

    old_price = existing_row.get("price")
    old_image = existing_row.get("main_image_url")
    old_updated = existing_row.get("updated_at_portal")

    new_price = to_float_safe(new_price_val)
    old_price_float = to_float_safe(old_price)

    if new_price is not None or old_price_float is not None:
        if new_price is None and old_price_float is not None:
            return True
        if new_price is not None and old_price_float is None:
            return True
        if new_price is not None and old_price_float is not None and new_price != old_price_float:
            return True

    if new_image_url is not None and new_image_url != old_image:
        return True

    if new_updated_at_portal is not None and new_updated_at_portal != old_updated:
        return True

    return False


def extract_error_code(exc: Exception | str | None) -> str | None:
    if exc is None:
        return None
    text = str(exc)
    match = re.search(r"\\bcode\\b[^0-9A-Za-z]+([0-9]{3,5})", text)
    if match:
        return match.group(1)
    return None


def is_rls_error(exc: Exception | str | None) -> bool:
    text = str(exc or "").lower()
    code = extract_error_code(exc)
    if code == "42501":
        return True
    return "row-level security policy" in text


def sanitize_scrape_log_payload(payload: dict) -> dict:
    clean = dict(payload or {})
    clean.pop("ts_sp", None)
    clean.pop("dry_run", None)
    return {key: value for key, value in clean.items() if key in SCRAPE_LOGS_ALLOWED_FIELDS}


def outbox_path_for_day(day_sp) -> Path:
    return OUTBOX_DIR / f"{OUTBOX_PREFIX}{day_sp.strftime('%Y%m%d')}.jsonl"


def load_seen_external_ids(path: Path) -> set[str]:
    seen: set[str] = set()
    if not path.exists():
        return seen

    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                external_id = str(obj.get("external_id") or "").strip()
                if external_id:
                    seen.add(external_id)
            except Exception:
                continue
    return seen


def refresh_outbox_state_for_day(day_sp) -> Path:
    global _OUTBOX_STATE_DAY, _OUTBOX_STATE_SEEN

    day_tag = day_sp.strftime('%Y%m%d')
    path = outbox_path_for_day(day_sp)

    if _OUTBOX_STATE_DAY != day_tag:
        _OUTBOX_STATE_DAY = day_tag
        _OUTBOX_STATE_SEEN = load_seen_external_ids(path)

    return path


def append_failed_outbox(record: dict) -> bool:
    day_sp = now_sp().date()
    path = refresh_outbox_state_for_day(day_sp)

    external_id = str(record.get("external_id") or "").strip()
    if external_id and external_id in _OUTBOX_STATE_SEEN:
        return False

    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")

    if external_id:
        _OUTBOX_STATE_SEEN.add(external_id)

    return True


def replay_failed_record(record: dict) -> tuple[bool, str | None]:
    if DRY_RUN:
        return False, "dry_run"
    if supabase_write is None:
        return False, "missing_service_role"

    mode = str(record.get("mode") or "")
    portal = str(record.get("portal") or PORTAL)
    external_id = str(record.get("external_id") or "")
    payload_raw = record.get("payload") or {}
    payload = dict(payload_raw) if isinstance(payload_raw, dict) else {}
    payload["deal_type"] = "venda"

    if mode == "insert":
        effective_external_id = external_id or str(payload.get("external_id") or "")
        if not payload.get("dedupe_key"):
            fallback_key = effective_external_id or str(payload.get("url") or "unknown")
            payload["dedupe_key"] = f"{portal}:{fallback_key}"

    try:
        if mode == "insert":
            supabase_write.table("listings").insert(payload).execute()
            return True, None

        if mode == "update":
            supabase_write.table("listings").update(payload).eq("portal", portal).eq("external_id", external_id).execute()
            return True, None

        if mode == "touch":
            supabase_write.table("listings").update(payload).eq("portal", portal).eq("external_id", external_id).execute()
            return True, None

        return False, f"modo_invalido:{mode}"

    except Exception as exc:
        code = extract_error_code(exc)
        if mode == "insert" and code == "23505":
            try:
                update_payload = dict(payload)
                update_payload.pop("external_id", None)
                update_payload.pop("published_at", None)
                update_payload.pop("first_seen_at", None)
                if update_payload:
                    supabase_write.table("listings").update(update_payload).eq("portal", portal).eq("external_id", external_id).execute()
                return True, None
            except Exception as up_exc:
                return False, str(up_exc)

        return False, str(exc)


def rewrite_jsonl(path: Path, records: list[dict]):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as file:
        for rec in records:
            file.write(json.dumps(rec, ensure_ascii=False) + "\n")
    tmp.replace(path)


def flush_single_outbox_file(path: Path) -> tuple[int, int, int]:
    if not path.exists():
        return 0, 0, 0

    total = 0
    flushed = 0
    pending: list[dict] = []

    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue

            total += 1
            try:
                rec = json.loads(line)
            except Exception:
                continue

            ok, _ = replay_failed_record(rec)
            if ok:
                flushed += 1
            else:
                pending.append(rec)

    rewrite_jsonl(path, pending)

    return total, flushed, len(pending)


def flush_outbox_if_due(force: bool = False):
    global _LAST_OUTBOX_FLUSH_TS

    if DRY_RUN or supabase_write is None:
        return

    now_ts = time.time()
    if not force and (now_ts - _LAST_OUTBOX_FLUSH_TS) < FLUSH_OUTBOX_EVERY_SECONDS:
        return

    _LAST_OUTBOX_FLUSH_TS = now_ts

    today_sp = now_sp().date()
    yesterday_sp = today_sp - timedelta(days=1)

    files = [outbox_path_for_day(yesterday_sp), outbox_path_for_day(today_sp)]

    total_all = 0
    flushed_all = 0
    pending_all = 0

    for path in files:
        total, flushed, pending = flush_single_outbox_file(path)
        total_all += total
        flushed_all += flushed
        pending_all += pending

    refresh_outbox_state_for_day(today_sp)

    if total_all > 0:
        print(
            f"Outbox flush: total={total_all} flushed={flushed_all} pending={pending_all}",
            flush=True,
        )


def db_client_for_read() -> Client | None:
    if supabase_read is not None:
        return supabase_read
    return supabase_write


def load_recent_ids(portal: str, hours: int) -> set[str]:
    client = db_client_for_read()
    if client is None:
        return set()

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    since_iso = since.isoformat()

    try:
        res = (
            client.table("listings")
            .select("external_id")
            .eq("portal", portal)
            .gte("published_at", since_iso)
            .execute()
        )
        data = res.data or []
        return {str(row.get("external_id")) for row in data if row.get("external_id") is not None}
    except Exception as exc:
        print(f"Falha ao carregar IDs recentes (published last {hours}h): {exc}", flush=True)
        return set()


def batch_load_existing(portal: str, ids: list[str]) -> dict[str, dict]:
    client = db_client_for_read()
    if client is None or not ids:
        return {}

    try:
        res = (
            client.table("listings")
            .select("external_id, price, main_image_url, updated_at_portal")
            .eq("portal", portal)
            .in_("external_id", ids)
            .execute()
        )
        data = res.data or []
        return {str(row.get("external_id")): row for row in data if row.get("external_id") is not None}
    except Exception as exc:
        print(f"Falha ao batch_load_existing: {exc}", flush=True)
        return {}


def salvar_imovel_manual(imovel: dict, existing_row: dict | None):
    listing = imovel.get("listing", {}) or {}
    pricing_infos = [x for x in (listing.get("pricingInfos") or []) if isinstance(x, dict)]
    pricing, pricing_business_type = select_pricing_info(listing, TARGET_BUSINESS_TYPE)

    ext_id = str(listing.get("id"))
    url_card = build_card_url(imovel, ext_id)

    created_raw = listing.get("createdAt")
    updated_raw = listing.get("updatedAt")

    stamps = listing.get("stamps") or []
    price_suggestion = listing.get("priceSuggestion") if isinstance(listing.get("priceSuggestion"), dict) else {}
    below_market, below_reason = detect_below_market(listing)

    image_url = extract_main_image_url(imovel)

    now_iso = now_sp().isoformat()

    unit_types = listing.get("unitTypes") or []
    property_type_normalized = get_normalized_type(unit_types)

    full_data = {
        "stamps": stamps,
        "priceSuggestion": price_suggestion,
        "below_market": below_market,
        "below_market_reason": below_reason,
        "unitTypes_raw": unit_types,
        "pricing_target_businessType": TARGET_BUSINESS_TYPE,
        "pricing_selected_businessType": pricing_business_type,
    }

    payload_insert = {
        "portal": PORTAL,
        "deal_type": "venda",
        "external_id": ext_id,
        "dedupe_key": f"{PORTAL}:{ext_id}",
        "url": url_card,
        "main_image_url": image_url,
        "title": listing.get("title"),
        "property_type": property_type_normalized,
        "price": pricing.get("price"),
        "city": (listing.get("address", {}) or {}).get("city"),
        "state": (listing.get("address", {}) or {}).get("stateAcronym"),
        "neighborhood": (listing.get("address", {}) or {}).get("neighborhood"),
        "area_m2": (listing.get("totalAreas") or [0])[0] if listing.get("totalAreas") else 0,
        "bedrooms": (listing.get("bedrooms") or [0])[0] if listing.get("bedrooms") else 0,
        "bathrooms": (listing.get("bathrooms") or [0])[0] if listing.get("bathrooms") else 0,
        "parking": (listing.get("parkingSpaces") or [0])[0] if listing.get("parkingSpaces") else 0,
        "condo_fee": pick_pricing_value(pricing_infos, pricing, "monthlyCondoFee"),
        "iptu": pick_pricing_value(pricing_infos, pricing, "yearlyIptu"),
        "last_seen_at": now_iso,
        "first_seen_at": now_iso,
        "published_at": created_raw,
        "updated_at_portal": updated_raw,
        "full_data": full_data,
    }

    print(
        f"Processando: id={ext_id} | Type={property_type_normalized} | Biz={pricing_business_type or 'N/A'} | Price={payload_insert.get('price')} | url={url_card}",
        flush=True,
    )

    mode = "insert"
    write_payload = payload_insert

    if existing_row:
        changed = should_update(existing_row, payload_insert.get("price"), image_url, updated_raw)

        old_price = to_float_safe(existing_row.get("price"))
        new_price = to_float_safe(payload_insert.get("price"))
        if old_price is not None and new_price is not None:
            if new_price < old_price:
                print(f"Preco caiu id={ext_id} old={old_price} new={new_price}", flush=True)
            elif new_price > old_price:
                print(f"Preco subiu id={ext_id} old={old_price} new={new_price}", flush=True)

        if changed:
            mode = "update"
            write_payload = dict(payload_insert)
            write_payload.pop("external_id", None)
            write_payload.pop("published_at", None)
            write_payload.pop("first_seen_at", None)
            if image_url is None:
                write_payload.pop("main_image_url", None)
        else:
            mode = "touch"
            write_payload = {"last_seen_at": now_iso, "deal_type": "venda"}

    if DRY_RUN:
        if mode == "insert":
            return {"action": "insert", "id": ext_id, "url": url_card, "is_rls": False}
        if mode == "update":
            return {"action": "update", "id": ext_id, "url": url_card, "is_rls": False}
        return {"action": "skip", "id": ext_id, "url": url_card, "is_rls": False}

    if supabase_write is None:
        reason = "missing_service_role"
        record = {
            "ts": now_iso,
            "portal": PORTAL,
            "external_id": ext_id,
            "url": url_card,
            "mode": mode,
            "payload": write_payload,
            "error_code": reason,
            "error": "SEM SERVICE ROLE KEY: escrita desabilitada para evitar perda silenciosa por RLS",
        }
        added = append_failed_outbox(record)
        if added:
            print(f"Outbox fallback salvo id={ext_id} motivo=missing_service_role", flush=True)
        return {
            "action": "error",
            "id": ext_id,
            "url": url_card,
            "is_rls": False,
            "error_code": reason,
            "error": reason,
        }

    try:
        if mode == "insert":
            supabase_write.table("listings").insert(write_payload).execute()
            return {"action": "insert", "id": ext_id, "url": url_card, "is_rls": False}

        if mode == "update":
            supabase_write.table("listings").update(write_payload).eq("portal", PORTAL).eq("external_id", ext_id).execute()
            return {"action": "update", "id": ext_id, "url": url_card, "is_rls": False}

        supabase_write.table("listings").update(write_payload).eq("portal", PORTAL).eq("external_id", ext_id).execute()
        return {"action": "skip", "id": ext_id, "url": url_card, "is_rls": False}

    except Exception as exc:
        error_text = str(exc)
        error_code = extract_error_code(exc)
        rls = is_rls_error(exc)

        record = {
            "ts": now_iso,
            "portal": PORTAL,
            "external_id": ext_id,
            "url": url_card,
            "mode": mode,
            "payload": write_payload,
            "error_code": error_code,
            "error": error_text,
        }
        added = append_failed_outbox(record)
        if added:
            print(f"Outbox fallback salvo id={ext_id} code={error_code}", flush=True)

        if not rls:
            print(f"Erro no imovel {ext_id}: {exc}", flush=True)

        return {
            "action": "error",
            "id": ext_id,
            "url": url_card,
            "is_rls": rls,
            "error_code": error_code,
            "error": error_text,
        }


def executar_ciclo():
    flush_outbox_if_due(force=False)

    inicio_req = time.time()
    run_id = f"local-{now_sp().strftime('%Y%m%d-%H%M%S')}"
    run_created = False

    if not DRY_RUN and supabase_write is not None:
        try:
            run_res = supabase_write.table("scrape_runs").insert({
                "status": "running",
                "city": "Campinas",
                "state": "SP",
            }).execute()
            if run_res and run_res.data:
                run_id = run_res.data[0]["id"]
                run_created = True
        except Exception as exc:
            print(f"Falha ao criar scrape_run: {exc}", flush=True)

    now_local = now_sp()
    hoje_sp = now_local.date()
    clock_hms = now_local.strftime("%H:%M:%S")
    ts_sp_str = now_local.strftime("%Y-%m-%d %H:%M:%S")

    print(
        f"\n[{clock_hms}] Buscando imoveis... "
        f"(SP={ts_sp_str}) | DRY_RUN={DRY_RUN} | RECENT_HOURS={RECENT_HOURS}",
        flush=True,
    )
    print(f"supabase_write_key = {SUPABASE_WRITE_KEY_MODE}", flush=True)
    if not DRY_RUN and SUPABASE_WRITE_KEY_MODE != "service_role":
        print(
            "ERRO CRITICO: SEM SERVICE ROLE KEY: escrita vai falhar por RLS. "
            "Apenas fallback para outbox esta ativo.",
            flush=True,
        )

    cards_collected = 0
    cards_upserted = 0
    status_code = 0
    bytes_recv = 0
    erro_msg = None

    count_today = 0
    count_recent = 0
    count_selected = 0
    inserts = 0
    updates = 0
    skips = 0
    errors = 0

    rls_blocked_count = 0
    rls_example_id = None
    rls_example_url = None

    try:
        global PRINT_FULL_REQUEST_URL_ON_START
        if PRINT_FULL_REQUEST_URL_ON_START:
            print(f"Request URL (completa): {URL}", flush=True)

        print(f"Request URL (len={len(URL)}): {URL[:220]}{'...' if len(URL) > 220 else ''}", flush=True)

        recent_ids_set = load_recent_ids(PORTAL, RECENT_HOURS)
        print(f"IDs recentes carregados (last {RECENT_HOURS}h): {len(recent_ids_set)}", flush=True)

        response = requests.get(URL, headers=HEADERS, timeout=25)
        status_code = response.status_code
        bytes_recv = len(response.content) if response.content else 0

        print(f"HTTP {status_code} | bytes={bytes_recv}", flush=True)

        if status_code != 200:
            erro_msg = f"API Error: {status_code}"
            raise RuntimeError(erro_msg)

        data = response.json()
        listings = (data.get("search", {}) or {}).get("result", {}).get("listings", []) or []
        print(f"Total de cards analisados (retornados pela API): {len(listings)}", flush=True)

        created_list = []
        missing_created = 0
        below_market_count = 0

        for item in listings:
            listing = item.get("listing", {}) or {}
            created_raw = listing.get("createdAt")
            created_dt = parse_iso(created_raw)
            if created_dt:
                created_list.append(created_dt)
            else:
                missing_created += 1

            bm, _ = detect_below_market(listing)
            if bm:
                below_market_count += 1

        print(f"Cards com createdAt: {len(created_list)} | sem createdAt: {missing_created}", flush=True)
        print(f"Cards com Preco abaixo do mercado (heuristica): {below_market_count}", flush=True)

        if created_list:
            newest = max(created_list).astimezone(TZ)
            oldest = min(created_list).astimezone(TZ)
            print(f"createdAt (SP) mais novo: {newest.isoformat()}", flush=True)
            print(f"createdAt (SP) mais velho: {oldest.isoformat()}", flush=True)

        sample_n = min(SAMPLE_N, len(listings))
        print(f"Amostra (primeiros {sample_n} cards):", flush=True)
        for item in listings[:sample_n]:
            listing = item.get("listing", {}) or {}
            ext_id = str(listing.get("id"))
            created_raw = listing.get("createdAt")
            updated_raw = listing.get("updatedAt")
            url_card = build_card_url(item, ext_id)

            unit_types = listing.get("unitTypes") or []
            norm_type = get_normalized_type(unit_types)

            ps = listing.get("priceSuggestion") if isinstance(listing.get("priceSuggestion"), dict) else {}
            ps_sum = summarize_price_suggestion(ps)
            bm, reason = detect_below_market(listing)

            created_dt = parse_iso(created_raw)
            created_sp_str = created_dt.astimezone(TZ).strftime('%Y-%m-%d %H:%M:%S') if created_dt else None

            print(
                f" - id={ext_id} | Type={norm_type} | createdAt={created_raw} (SP={created_sp_str}) | "
                f"updatedAt={updated_raw} | below_market={bm} ({reason}) | url={url_card} | ps={ps_sum}",
                flush=True,
            )

        selected_items = []
        selected_ids = []

        for item in listings:
            listing = item.get("listing", {}) or {}
            ext_id = str(listing.get("id"))

            created_dt = parse_iso(listing.get("createdAt"))
            is_today = bool(created_dt and created_dt.astimezone(TZ).date() == hoje_sp)
            is_recent = ext_id in recent_ids_set

            if is_today:
                count_today += 1
            if is_recent:
                count_recent += 1

            if is_today or is_recent:
                selected_items.append(item)
                selected_ids.append(ext_id)

        count_selected = len(selected_items)
        cards_collected = count_selected

        print(
            f"Selecao: hoje(SP)={count_today} | recentes(last {RECENT_HOURS}h)={count_recent} | selecionados={count_selected}",
            flush=True,
        )

        if not selected_items:
            print("Nada para processar (nem HOJE, nem IDs recentes).", flush=True)
        else:
            existing_by_id = batch_load_existing(PORTAL, selected_ids)
            print(f"Existentes no banco (batch IN): {len(existing_by_id)} de {len(selected_ids)}", flush=True)

            for imovel in selected_items:
                listing = imovel.get("listing", {}) or {}
                ext_id = str(listing.get("id"))

                existing_row = existing_by_id.get(ext_id)
                result = salvar_imovel_manual(imovel, existing_row)

                action = result.get("action")
                if action == "insert":
                    inserts += 1
                    cards_upserted += 1
                elif action == "update":
                    updates += 1
                    cards_upserted += 1
                elif action == "skip":
                    skips += 1
                else:
                    errors += 1
                    if result.get("is_rls"):
                        rls_blocked_count += 1
                        if rls_example_id is None:
                            rls_example_id = result.get("id")
                            rls_example_url = result.get("url")

        if run_created and not DRY_RUN and supabase_write is not None:
            try:
                supabase_write.table("scrape_runs").update({
                    "status": "completed",
                    "finished_at": now_sp().isoformat(),
                }).eq("id", run_id).execute()
            except Exception as exc:
                print(f"Falha ao fechar scrape_run completed: {exc}", flush=True)

    except Exception as exc:
        erro_msg = str(exc)
        print(f"Erro no ciclo: {erro_msg}", flush=True)
        if run_created and not DRY_RUN and supabase_write is not None:
            try:
                supabase_write.table("scrape_runs").update({
                    "status": "failed",
                    "finished_at": now_sp().isoformat(),
                }).eq("id", run_id).execute()
            except Exception:
                pass

    finally:
        duration = int((time.time() - inicio_req) * 1000)

        if rls_blocked_count > 0:
            print(
                f"{now_sp().isoformat()} RLS BLOCKED count={rls_blocked_count} "
                f"example_id={rls_example_id} example_url={rls_example_url}",
                flush=True,
            )

        print(
            f"Resumo ciclo: selecionados={count_selected} | inserts={inserts} | updates={updates} | skips={skips} | errors={errors}",
            flush=True,
        )

        log_payload = {
            "run_id": run_id,
            "portal": PORTAL,
            "status_code": status_code,
            "duration_ms": duration,
            "bytes_received": bytes_recv,
            "cards_collected": cards_collected,
            "cards_upserted": cards_upserted,
            "render_used": False,
            "error_msg": erro_msg,
        }
        log_payload = sanitize_scrape_log_payload(log_payload)

        if DRY_RUN:
            print("DRY_RUN=1: scrape_logs nao enviado", flush=True)
        elif supabase_write is None:
            print("scrape_logs ignorado: sem service role key", flush=True)
        else:
            try:
                supabase_write.table("scrape_logs").insert(log_payload).execute()
                print("Log de scrape salvo", flush=True)
            except Exception as log_exc:
                print(f"Erro ao salvar scrape_logs: {log_exc}", flush=True)


if __name__ == "__main__":
    first = True
    while True:
        PRINT_FULL_REQUEST_URL_ON_START = first
        first = False

        executar_ciclo()

        if RUN_ONCE:
            print("RUN_ONCE=1 -> saindo", flush=True)
            break

        print(f"Aguardando {SLEEP_SECONDS}s...", flush=True)
        time.sleep(SLEEP_SECONDS)

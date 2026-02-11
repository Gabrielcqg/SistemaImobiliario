import argparse
import asyncio
import inspect
from pathlib import Path

from bs4 import BeautifulSoup

from app.scrapers.imovelweb import ImovelwebScraper


async def _call_maybe_async(fn, *args, **kwargs):
    res = fn(*args, **kwargs)
    if inspect.isawaitable(res):
        return await res
    return res


async def fetch_html_best_effort(url: str) -> str:
    """
    Tenta usar seu StealthFetcher (sync ou async) com vários nomes de método comuns.
    Se não achar, levanta erro pra você saber.
    """
    try:
        from app.scrapers.stealth import StealthFetcher
    except Exception as e:
        raise RuntimeError(
            "Não consegui importar app.scrapers.stealth.StealthFetcher. "
            "Use --html-file (offline) ou ajuste o import."
        ) from e

    f = StealthFetcher()

    candidate_methods = [
        "fetch_html",
        "get_html",
        "fetch",
        "get",
        "request",
    ]

    last_err = None
    for name in candidate_methods:
        if not hasattr(f, name):
            continue

        fn = getattr(f, name)

        # tenta chamar com apenas (url)
        try:
            resp = await _call_maybe_async(fn, url)
        except TypeError:
            # alguns fetchers pedem headers/proxy/etc. (ignoramos aqui)
            continue
        except Exception as e:
            last_err = e
            continue

        # normaliza retorno
        if isinstance(resp, str):
            return resp
        if isinstance(resp, dict) and "html" in resp and isinstance(resp["html"], str):
            return resp["html"]
        if hasattr(resp, "text") and isinstance(resp.text, str):
            return resp.text

    raise RuntimeError(f"Não consegui obter HTML via StealthFetcher. Último erro: {last_err}")


def print_sample(cards, limit: int):
    limit = min(limit, len(cards))
    for i in range(limit):
        c = cards[i]
        logo = None
        for attr in ("agency_logo_url", "advertiser_logo_url", "publisher_logo_url"):
            if hasattr(c, attr):
                logo = getattr(c, attr)
                break

        print(
            f"\n--- CARD {i} ---"
            f"\nTitle: {getattr(c, 'title', None)}"
            f"\nURL: {getattr(c, 'url', None)}"
            f"\nPrice: {getattr(c, 'price', None)}"
            f"\nDaysAgo: {getattr(c, 'published_days_ago', None)}"
            f"\nCity/State/Bairro: {getattr(getattr(c, 'location', None), 'city', None)} / "
            f"{getattr(getattr(c, 'location', None), 'state', None)} / "
            f"{getattr(getattr(c, 'location', None), 'neighborhood', None)}"
            f"\nSpecs: area={getattr(getattr(c, 'specs', None), 'area', None)}, "
            f"beds={getattr(getattr(c, 'specs', None), 'bedrooms', None)}, "
            f"baths={getattr(getattr(c, 'specs', None), 'bathrooms', None)}, "
            f"park={getattr(getattr(c, 'specs', None), 'parking', None)}"
            f"\nMainImage: {getattr(c, 'main_image_url', None)}"
            f"\nLogo: {logo}"
        )


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="URL de listagem do Imovelweb (teste online).")
    ap.add_argument("--html-file", help="Arquivo HTML salvo (teste offline).")
    ap.add_argument("--recency-days", type=int, default=7, help="Filtro de recência (dias).")
    ap.add_argument("--show", type=int, default=5, help="Quantos cards imprimir.")
    args = ap.parse_args()

    scraper = ImovelwebScraper()

    if args.html_file:
        html = Path(args.html_file).read_text(encoding="utf-8", errors="ignore")
        source = f"FILE={args.html_file}"
    else:
        if not args.url:
            # um default genérico (você pode trocar por um filtro seu)
            args.url = "https://www.imovelweb.com.br/apartamentos-venda-campinas-sp.html"
        html = await fetch_html_best_effort(args.url)
        source = f"URL={args.url}"

    print(f"\n[TEST] Source: {source}")
    print(f"[TEST] HTML size: {len(html)} chars")

    blocked = scraper.is_blocked(html)
    incomplete = scraper.is_incomplete(html)
    print(f"[TEST] is_blocked={blocked} | is_incomplete={incomplete}")

    soup = BeautifulSoup(html, "html.parser")
    raw_cards = scraper._extract_cards(soup)  # sim, é método "privado", mas serve pra teste
    print(f"[TEST] _extract_cards found: {len(raw_cards)}")

    cards = scraper.parse_cards(html, recency_days=args.recency_days)
    print(f"[TEST] parse_cards returned: {len(cards)} (recency_days={args.recency_days})")

    if cards:
        # checks simples pra te dizer se tá pegando "logo" como imagem por engano
        bad_img = 0
        for c in cards:
            img = getattr(c, "main_image_url", "") or ""
            if ("/empresas/" in img) or ("logo" in img.lower()):
                bad_img += 1
        print(f"[TEST] main_image_url suspeita (logo/empresas): {bad_img}/{len(cards)}")

        print_sample(cards, args.show)

    # status code “amigável”: se bloqueou, você já sabe
    if blocked:
        print("\n[RESULT] BLOQUEADO (WAF/Cloudflare/captcha). O parser pode estar OK, mas o fetch não.")
    elif len(raw_cards) == 0:
        print("\n[RESULT] NÃO ACHOU CARDS. Provável mudança de HTML/JS ou você pegou HTML incompleto.")
    elif len(cards) == 0:
        print("\n[RESULT] ACHOU cards no HTML, mas parse_cards filtrou tudo (recency/seletores/campos).")
    else:
        print("\n[RESULT] OK: parser está extraindo cards.")


if __name__ == "__main__":
    asyncio.run(main())

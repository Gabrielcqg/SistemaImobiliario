from typing import List, Dict
from app.scrapers.stealth import StealthFetcher
from app.scrapers.imovelweb import ImovelwebScraper
from app.scrapers.zap import ZapScraper
from app.scrapers.vivareal import VivaRealScraper
from app.models.offer import OfferCard, SearchResponse
from app.core.supabase import supabase
import asyncio
import json
import hashlib
from datetime import datetime
from fastapi.encoders import jsonable_encoder

class SearchService:
    def __init__(self):
        self.fetcher = StealthFetcher()
        self.scrapers = {
            "imovelweb": ImovelwebScraper(),
            "zap": ZapScraper(),
            "vivareal": VivaRealScraper()
        }
    
    def _generate_hash(self, filters: Dict) -> str:
        return hashlib.md5(json.dumps(filters, sort_keys=True).encode()).hexdigest()

    async def search(self, filters: Dict, page: int = 1, page_size: int = 20):
        filters_hash = self._generate_hash(filters)
        
        # 1. Check Cache with TTL (10 mins) and Status check
        cache_query = supabase.table("search_runs").select("*").eq("filters_hash", filters_hash).execute()
        
        if cache_query.data:
            cache_data = cache_query.data[0]
            created_at = datetime.fromisoformat(cache_data["created_at"].replace('Z', '+00:00'))
            now = datetime.now(created_at.tzinfo)
            age_minutes = (now - created_at).total_seconds() / 60
            
            if age_minutes < 10 and cache_data["status"] == "completed":
                print(f"⚡ [CACHE] Resultados recuperados (Idade: {int(age_minutes)} min)")
                run_id = cache_data["id"]
                cards_resp = supabase.table("offer_cards").select("*").eq("run_id", run_id).execute()
                all_cards = [OfferCard(**c["full_data"]) for c in cards_resp.data]
                
                # Sort exactly like the fresh results would be
                all_cards.sort(key=lambda x: (x.published_days_ago if x.published_days_ago is not None else 999, x.price or 999999999))
                
                total = len(all_cards)
                start = (page - 1) * page_size
                end = start + page_size
                paginated_cards = all_cards[start:end]
                
                yield jsonable_encoder({
                    "type": "results",
                    "data": SearchResponse(
                        results=paginated_cards, 
                        metadata={"cached": True, "count": total, "scrape_status": {"all": "cached"}},
                        pagination={"total_pages": 1, "page": page, "page_size": page_size, "has_next": end < total, "total_results": total}
                    ).model_dump()
                })
                return
            else:
                print(f"🗑️ Cache obsoleta ou incompleta ({int(age_minutes)} min, status: {cache_data['status']}). Removendo...")
                run_id_to_delete = cache_data["id"]
                try:
                    supabase.table("scrape_logs").delete().eq("run_id", run_id_to_delete).execute()
                    supabase.table("offer_cards").delete().eq("run_id", run_id_to_delete).execute()
                    supabase.table("search_runs").delete().eq("id", run_id_to_delete).execute()
                except Exception as e:
                    print(f"⚠️ Erro ao limpar cache: {e}")

        # 2. Scrape if not cached
        run_resp = supabase.table("search_runs").insert({"filters_hash": filters_hash, "filters_json": filters, "status": "running"}).execute()
        run_id = run_resp.data[0]["id"]
        
        scrape_status = {}
        total_pages_found = 1
        yield {"type": "run_id", "data": run_id}

        print(f"\n🚀 Iniciando busca para: {filters.get('query', 'Geral')} em {filters.get('city', 'Campinas')}")
        print(f"📊 Run ID: {run_id}\n")

        # Run scrapers in parallel for faster first-yield
        MAX_DEPTH_PAGES = 20
        
        async def scrape_portal(name, scraper):
            nonlocal total_pages_found
            start_time = datetime.now()
            print(f"🔍 [{name.upper()}] Buscando imóveis via local Stealth...")
            
            # Use a slightly larger window for "background loading" feel, or just the requested page
            # To satisfy "20 pages" request, but user later requested 10 pages max.
            # We will use 10 pages for VivaReal and Zap as requested.
            PAGE_LIMIT = 10 if name.lower() in ["vivareal", "zap"] else 20
            
            for current_page in range(page, min(page + PAGE_LIMIT, MAX_DEPTH_PAGES + 1)):
                if current_page > page:
                    print(f"📄 [{name.upper()}] Avançando para página {current_page} no background...")
                try:
                    url = scraper.build_url(city=filters.get("city", "campinas"), state=filters.get("state", "sp"), filters=filters, page=current_page)
                    print(f"🔗 [{name.upper()}] URL: {url}")
                    
                    html = await self.fetcher.fetch(url)
                    if not html or scraper.is_blocked(html):
                        scrape_status[name] = "blocked"
                        return

                    cards = scraper.parse_cards(html, recency_days=filters.get("recency_days", 7))
                    print(f"🧐 [{name.upper()}] Página {current_page}: Processando {len(cards)} candidatos recentes...")
                    
                    if current_page == page:
                        tp = scraper.extract_total_pages(html)
                        total_pages_found = max(total_pages_found, tp)

                    for card in cards:
                        # Deep Crawl for details
                        print(f"🏠 [{name.upper()}] Buscando detalhes de: {card.url}...")
                        try:
                            # We can keep deep crawl sequential for now to avoid hammering source too hard
                            # or use a small semaphore. Let's keep it simple first.
                            detail_html = await self.fetcher.fetch(card.url)
                            if detail_html and not scraper.is_blocked(detail_html):
                                details = scraper.extract_details(detail_html)
                                if details:
                                    # Update card with detailed info
                                    if details.get("title"): card.title = details["title"]
                                    if details.get("price"): card.price = details["price"]
                                    if details.get("main_image_url"): card.main_image_url = details["main_image_url"]
                                    if "area" in details: card.specs.area = details["area"]
                                    if "bedrooms" in details: card.specs.bedrooms = details["bedrooms"]
                                    if "bathrooms" in details: card.specs.bathrooms = details["bathrooms"]
                                    if "parking" in details: card.specs.parking = details["parking"]
                                    if "date_text" in details:
                                        # Now we can safely call this method as it's implemented in VivaRealScraper
                                        new_days = scraper.calculate_days_ago(details["date_text"])
                                        
                                        # Only update if valid days returned
                                        if new_days is not None:
                                           # Check specifically for update
                                           if new_days < (card.published_days_ago or 999):
                                               card.published_days_ago = new_days

                                    print(f"      ∟ ✅ Detalhes extraídos: {card.specs.area}m², {card.specs.bedrooms} qto, {card.price} BRL")
                        except Exception as de:
                            print(f"      ⚠️  Erro ao buscar detalhes: {de}")

                        # Filtering
                        price_min = filters.get("price_min")
                        price_max = filters.get("price_max")
                        if price_min and card.price and card.price < float(price_min): continue
                        if price_max and card.price and card.price > float(price_max): continue
                        
                        if not card.location.neighborhood and card.title:
                            parts = card.title.split(",")
                            if len(parts) > 1: card.location.neighborhood = parts[0].strip()

                        # Strict Filtering (Global):
                        # If the card is older than the requested limit (or 999 if unknown and we are strict), skip it.
                        # For VivaReal, we force detailed crawl, so if it's still 999, it means we failed to find a date.
                        recency_limit = filters.get("recency_days", 7)
                        if card.published_days_ago and card.published_days_ago > recency_limit:
                             print(f"      🗑️  Filtrado (Muito antigo/Desconhecido: {card.published_days_ago} dias > {recency_limit})")
                             continue

                        # Save to DB (Persistent storage)
                        card_data = {
                            "external_id": card.external_id, "portal": card.portal, "url": card.url,
                            "title": card.title, "price": card.price, "specs": card.specs.model_dump(),
                            "location": card.location.model_dump(), "last_seen": card.last_seen.isoformat(),
                            "full_data": card.model_dump(), "run_id": run_id
                        }
                        try:
                            supabase.table("offer_cards").upsert(card_data, on_conflict="portal, external_id").execute()
                        except: pass

                        # Yield individual card for real-time update
                        yield card

                except Exception as e:
                    print(f"❌ [{name.upper()}] Erro no scraper: {e}")
                    scrape_status[name] = f"error: {str(e)}"

            scrape_status[name] = "ok" if scrape_status.get(name) != "blocked" else "blocked"
            
            # Log completion for this portal
            duration = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Print specific stats if available (e.g. VivaReal)
            if hasattr(scraper, "print_stats"):
                scraper.print_stats()

            try:
                supabase.table("scrape_logs").insert({
                    "run_id": run_id, "portal": name, "status_code": 200,
                    "duration_ms": duration, "bytes_received": 0, "render_used": True, "cost_estimate": 0
                }).execute()
            except: pass

        # To stream results as they come from different portals, we'll run them and yield
        # Actually, let's keep it sequential for the POC but yielding each card.
        # Parallelizing generators in Python is tricky; we'd need a queue.
        # Let's do a simple queue-based parallel run.
        
        queue = asyncio.Queue()
        
        async def producer(name, scraper):
            async for card in scrape_portal(name, scraper):
                await queue.put(card)
        
        # Start all producers
        tasks = [asyncio.create_task(producer(n, s)) for n, s in self.scrapers.items()]
        
        # Monitor tasks and yield from queue
        while any(not t.done() for t in tasks) or not queue.empty():
            try:
                card = await asyncio.wait_for(queue.get(), timeout=0.1)
                yield {"type": "card", "data": jsonable_encoder(card)}
            except asyncio.TimeoutError:
                continue

        # Final Status
        try:
            supabase.table("search_runs").update({"status": "completed"}).eq("id", run_id).execute()
        except: pass

        yield jsonable_encoder({
            "type": "results_final",
            "metadata": {"scrape_status": scrape_status, "total_pages": total_pages_found}
        })



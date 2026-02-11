from fastapi import APIRouter, Query, HTTPException, WebSocket, WebSocketDisconnect
from app.services.search_service import SearchService
from app.models.offer import SearchResponse
import json
import asyncio

router = APIRouter()
service = SearchService()

@router.get("/offers", response_model=SearchResponse)
async def search_offers(
    query: str = Query(..., description="Neighborhood (Mandatory)", min_length=2),
    city: str = Query("Campinas"),
    state: str = Query("SP"),
    operation: str = Query("sale", pattern="^(sale|rent)$"),
    property_type: str = Query("apartment", pattern="^(apartment|house|land|all)$"),
    recency_days: int = Query(7, ge=1, le=30),
    price_min: int = Query(..., ge=0, description="Minimum Price (Mandatory)"),
    price_max: int = Query(..., ge=0, description="Maximum Price (Mandatory)"),
    bedrooms_min: int = Query(..., ge=0, description="Minimum Bedrooms (Mandatory)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    filters = {
        "query": query, "city": city, "state": state, "operation": operation,
        "property_type": property_type, "recency_days": recency_days,
        "price_min": price_min, "price_max": price_max, "bedrooms_min": bedrooms_min
    }
    
    try:
        print(f"\n🔍 [API] Recebida busca HTTP: {query} ({city}/{state})")
        results = []
        metadata = {}
        pagination = {}
        
        async for msg in service.search(filters, page=page, page_size=page_size):
            if msg["type"] == "results":
                return SearchResponse(**msg["data"])
            elif msg["type"] == "card":
                results.append(msg["data"])
            elif msg["type"] == "results_final":
                metadata = msg["metadata"]
                pagination = {
                    "total_pages": metadata.get("total_pages", 1),
                    "page": page, "page_size": page_size,
                    "has_next": page < metadata.get("total_pages", 1),
                    "total_results": len(results)
                }

        return SearchResponse(
            results=results,
            metadata={"scrape_status": metadata.get("scrape_status", {}), "count": len(results)},
            pagination=pagination
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.websocket("/ws")
async def search_offers_ws(websocket: WebSocket):
    await websocket.accept()
    try:
        # User sends filters as JSON
        data = await websocket.receive_text()
        params = json.loads(data)
        
        filters = params.get("filters", {})
        page = params.get("page", 1)
        page_size = params.get("page_size", 20)
        
        print(f"\n🔌 [WS] Iniciando stream de busca: {filters.get('query')}")
        
        async for msg in service.search(filters, page=page, page_size=page_size):
            await websocket.send_json(msg)
            
    except WebSocketDisconnect:
        print("🔌 [WS] Conexão encerrada pelo cliente.")
    except Exception as e:
        print(f"❌ [WS] Erro: {e}")
        await websocket.send_json({"type": "error", "message": str(e)})
    finally:
        try:
            await websocket.close()
        except: pass

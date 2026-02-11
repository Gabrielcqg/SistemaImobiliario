import asyncio
import websockets
import json

async def test_ws():
    uri = "ws://localhost:8000/api/v1/search/ws"
    try:
        async with websockets.connect(uri) as websocket:
            filters = {
                "query": "Taquaral",
                "city": "Campinas",
                "state": "SP",
                "operation": "sale",
                "property_type": "apartment",
                "recency_days": 7,
                "price_min": 100000,
                "price_max": 3000000,
                "bedrooms_min": 2
            }
            await websocket.send(json.dumps({"filters": filters, "page": 1, "page_size": 10}))
            
            while True:
                try:
                    message = await websocket.recv()
                    data = json.loads(message)
                    print(f"Received: {data.get('type')}")
                    if data.get('type') == 'card':
                        print(f"  - Card: {data['data']['url']}")
                    if data.get('type') == 'results_final':
                        print(f"Final results metadata: {data['metadata']}")
                        break
                    if data.get('type') == 'error':
                        print(f"Error: {data['message']}")
                        break
                except websockets.exceptions.ConnectionClosed:
                    print("Connection closed")
                    break
    except Exception as e:
        print(f"Failed to connect: {e}")

if __name__ == "__main__":
    asyncio.run(test_ws())

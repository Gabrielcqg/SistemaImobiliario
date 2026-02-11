
from fastapi.testclient import TestClient
from app.main import app
import json

client = TestClient(app)

def test_missing_mandatory_filters():
    print("\n🧪 Testing missing mandatory filters...")
    
    # Test case 1: Missing everything
    response = client.get("/api/v1/search/offers")
    print(f"Empty request status: {response.status_code}")
    assert response.status_code == 422
    
    # Test case 2: Missing only price_max
    params = {
        "query": "Taquaral",
        "price_min": 100000,
        "bedrooms_min": 2
    }
    response = client.get("/api/v1/search/offers", params=params)
    print(f"Missing price_max status: {response.status_code}")
    assert response.status_code == 422
    
    # Test case 3: All mandatory present
    params["price_max"] = 3000000
    # Note: This might trigger actual scraping if not mocked, 
    # but we just want to see if it passes the validation layer.
    # In a real test we'd mock the service, but here we can check if it gets past 422.
    response = client.get("/api/v1/search/offers", params=params)
    print(f"Full request status: {response.status_code}")
    # It might be 500 if supabase/fetcher fails, but shouldn't be 422
    assert response.status_code != 422

if __name__ == "__main__":
    try:
        test_missing_mandatory_filters()
        print("\n✅ Verification SUCCESS: Mandatory filters are enforced at the API level.")
    except Exception as e:
        print(f"\n❌ Verification FAILED: {e}")

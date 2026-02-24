import csv
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

TIMEOUT = 8
MAX_WORKERS = 20  # pode ajustar (10-30 costuma ser bom)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; URLChecker/1.0)"
}

def check_url(url: str) -> dict:
    url = url.strip()
    if not url:
        return None

    try:
        # Tenta HEAD primeiro (mais leve)
        resp = requests.head(url, allow_redirects=True, timeout=TIMEOUT, headers=HEADERS)

        # Alguns sites bloqueiam HEAD -> fallback para GET
        if resp.status_code in (403, 405) or resp.status_code >= 500:
            resp = requests.get(url, allow_redirects=True, timeout=TIMEOUT, headers=HEADERS)

        status = resp.status_code

        if 200 <= status < 400:
            situacao = "ATIVA"
        elif 400 <= status < 600:
            situacao = "ERRO"
        else:
            situacao = "DESCONHECIDO"

        return {
            "url": url,
            "situacao": situacao,
            "status_code": status,
            "url_final": resp.url
        }

    except requests.exceptions.Timeout:
        return {
            "url": url,
            "situacao": "TIMEOUT",
            "status_code": "",
            "url_final": ""
        }
    except requests.exceptions.RequestException as e:
        return {
            "url": url,
            "situacao": "FALHA_CONEXAO",
            "status_code": "",
            "url_final": "",
            "erro": str(e)
        }

def main():
    with open("urls.txt", "r", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip()]

    resultados = []
    inicio = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(check_url, url): url for url in urls}

        for i, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            if result:
                resultados.append(result)

            if i % 50 == 0:
                print(f"Processadas: {i}/{len(urls)}")

    with open("resultado_urls.csv", "w", newline="", encoding="utf-8") as f:
        fieldnames = ["url", "situacao", "status_code", "url_final", "erro"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in resultados:
            writer.writerow(r)

    fim = time.time()
    print(f"\nConcluído! {len(resultados)} URLs verificadas em {fim - inicio:.2f}s")
    print("Arquivo salvo: resultado_urls.csv")

if __name__ == "__main__":
    main()
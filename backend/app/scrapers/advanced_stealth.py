"""
Advanced Stealth Fetcher Module with Human Behavior Simulation.

Techniques implemented:
1. curl_cffi with JA3/TLS fingerprint mimicry (Chrome 120)
2. Rotative User-Agents pool
3. Human-like behavior simulation (when using Playwright)
4. Smart cookie/session management
5. Anti-fingerprinting headers
"""

import asyncio
import random
import time
import re
from typing import Optional, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup

# curl_cffi for TLS fingerprint bypass
from curl_cffi import requests as cur_requests
from curl_cffi.requests import Session

# ===========================
# 1. USER-AGENT ROTATION POOL
# ===========================
# Atualizado com User-Agents reais e populares (Chrome/Firefox/Edge)
USER_AGENTS = [
    # Chrome Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    # Chrome Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    # Firefox Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    # Edge
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
]

def get_random_user_agent() -> str:
    return random.choice(USER_AGENTS)

# ===========================
# 2. ANTI-FINGERPRINT HEADERS
# ===========================
def get_stealth_headers(referer: str = None, user_agent: str = None) -> Dict[str, str]:
    """
    Retorna headers que mimetizam um navegador real.
    Inclui Sec-Fetch-* headers que são verificados pelo Cloudflare.
    """
    ua = user_agent or get_random_user_agent()
    
    headers = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        # Critical Sec-Fetch headers that Cloudflare checks
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin" if referer else "none",
        "Sec-Fetch-User": "?1",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"' if "Windows" in ua else '"macOS"',
    }
    
    if referer:
        headers["Referer"] = referer
        headers["Origin"] = referer.split("/")[0] + "//" + referer.split("/")[2]
    
    return headers


# ===========================
# 3. ADVANCED CURL_CFFI FETCHER
# ===========================
class AdvancedStealthFetcher:
    """
    Fetcher avançado usando curl_cffi com:
    - Impersonação de Chrome real (JA3/TLS fingerprint)
    - Sessão persistente para manter cookies
    - Jitter humano entre requisições
    - Headers anti-fingerprinting
    """
    
    # Impersonation options disponíveis no curl_cffi
    IMPERSONATE_OPTIONS = ["chrome120", "chrome119", "chrome110", "edge101"]
    
    def __init__(self, impersonate: str = "chrome120"):
        self.impersonate = impersonate
        self.session: Optional[Session] = None
        self.last_request_time = 0
        self.request_count = 0
        self.base_referer = None
        
    def _ensure_session(self):
        """Cria sessão persistente se não existir."""
        if not self.session:
            self.session = Session(impersonate=self.impersonate)
    
    def _human_jitter(self, min_sec: float = 3.0, max_sec: float = 7.5) -> float:
        """
        Jitter não-linear para mimetizar comportamento humano.
        Usa distribuição gaussiana truncada para parecer mais natural.
        """
        # Gaussian-like jitter (mais tempo no meio, menos nos extremos)
        mean = (min_sec + max_sec) / 2
        std = (max_sec - min_sec) / 4
        jitter = random.gauss(mean, std)
        # Clamp to bounds
        return max(min_sec, min(max_sec, jitter))
    
    async def fetch(
        self, 
        url: str, 
        referer: str = None,
        min_jitter: float = 3.0,
        max_jitter: float = 7.5,
        timeout: int = 20
    ) -> Tuple[str, int, Dict[str, Any]]:
        """
        Fetch uma URL com bypass de Cloudflare.
        
        Returns:
            Tuple of (html, status_code, metadata)
        """
        self._ensure_session()
        
        # Jitter humano (não-bloqueante)
        jitter = self._human_jitter(min_jitter, max_jitter)
        time_since_last = time.time() - self.last_request_time
        if time_since_last < jitter:
            await asyncio.sleep(jitter - time_since_last)
        
        # Headers anti-fingerprint
        headers = get_stealth_headers(referer=referer or self.base_referer)
        
        meta = {
            "url": url,
            "referer": referer,
            "jitter": jitter,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        try:
            # Usar asyncio.to_thread para não bloquear o event loop
            def do_request():
                return self.session.get(url, headers=headers, timeout=timeout)
            
            resp = await asyncio.to_thread(do_request)
            
            self.last_request_time = time.time()
            self.request_count += 1
            
            meta["status_code"] = resp.status_code
            meta["content_length"] = len(resp.text)
            meta["cookies_count"] = len(self.session.cookies)
            
            html = resp.text if resp.status_code == 200 else ""
            
            # Detectar bloqueio
            if resp.status_code == 403 or self._is_blocked(html):
                meta["blocked"] = True
                return "", resp.status_code, meta
            
            meta["blocked"] = False
            return html, resp.status_code, meta
            
        except Exception as e:
            meta["error"] = str(e)
            meta["blocked"] = True
            return "", 0, meta
    
    def fetch_sync(
        self, 
        url: str, 
        referer: str = None,
        timeout: int = 20
    ) -> Tuple[str, int]:
        """
        Versão síncrona do fetch (para uso fora de async).
        """
        self._ensure_session()
        headers = get_stealth_headers(referer=referer)
        
        try:
            resp = self.session.get(url, headers=headers, timeout=timeout)
            html = resp.text if resp.status_code == 200 else ""
            return html, resp.status_code
        except Exception:
            return "", 0
    
    def _is_blocked(self, html: str) -> bool:
        """Detecta se a resposta é uma página de challenge/bloqueio."""
        if not html:
            return True
        
        block_indicators = [
            "Just a moment",
            "Attention Required",
            "Access Denied",
            "Enable JavaScript",
            "checking your browser",
            "cf-browser-verification",
            "challenge-running",
        ]
        
        for indicator in block_indicators:
            if indicator.lower() in html.lower():
                return True
        
        return False
    
    def set_base_referer(self, url: str):
        """Define um referer base para todas as requisições subsequentes."""
        self.base_referer = url
    
    def close(self):
        """Fecha a sessão."""
        if self.session:
            self.session.close()
            self.session = None


# ===========================
# 4. ROBUST DATE EXTRACTION
# ===========================
def extract_publication_date(html: str) -> Dict[str, Any]:
    """
    Extração robusta de data de publicação do VivaReal.
    
    Lida com o HTML complexo:
    <p class="text-neutral-110 text-1-5 font-secondary">
        "Publicado há "
        "1 mês"
        ", atualizado há 9 horas"
        "."
    </p>
    
    Returns:
        Dict com: date_text, published_at, days_ago, source
    """
    soup = BeautifulSoup(html, "html.parser")
    result = {
        "date_text": None,
        "published_at": None,
        "days_ago": None,
        "source": None
    }
    
    # ESTRATÉGIA 1: Seletor específico do VivaReal (mais confiável)
    # O seletor precisa lidar com múltiplas classes
    date_selectors = [
        "p.text-neutral-110.text-1-5.font-secondary",  # Classe exata
        'p[class*="text-neutral-110"][class*="font-secondary"]',  # Partial match
        ".flex.gap-1.items-center p",  # Contexto do container
        'section.flex p[class*="neutral"]',  # Container section
    ]
    
    for selector in date_selectors:
        elements = soup.select(selector)
        for el in elements:
            # Pegar TODO o texto, incluindo nós filhos
            full_text = el.get_text(" ", strip=True)
            # Limpar espaços múltiplos e normalizar
            full_text = re.sub(r'\s+', ' ', full_text).strip()
            
            # Verificar se contém indicadores de data
            if re.search(r'(Publicado|Atualizado|há|criado em)', full_text, re.I):
                result["date_text"] = full_text
                result["source"] = f"SELECTOR:{selector}"
                break
        if result["date_text"]:
            break
    
    # ESTRATÉGIA 2: Busca por texto em toda a página
    if not result["date_text"]:
        # Procurar qualquer elemento que contenha o padrão de data
        for el in soup.find_all(string=re.compile(r'(Publicado há|Atualizado há)', re.I)):
            parent = el.find_parent()
            if parent:
                full_text = parent.get_text(" ", strip=True)
                full_text = re.sub(r'\s+', ' ', full_text).strip()
                result["date_text"] = full_text
                result["source"] = "TEXT_SEARCH"
                break
    
    # ESTRATÉGIA 3: JSON-LD / __NEXT_DATA__
    if not result["date_text"]:
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "{}")
                for key in ["datePosted", "datePublished", "createdAt"]:
                    if key in str(data):
                        # Buscar recursivamente
                        date_val = _find_key_recursive(data, key)
                        if date_val:
                            result["date_text"] = date_val
                            result["source"] = f"JSON_LD:{key}"
                            break
            except:
                pass
            if result["date_text"]:
                break
    
    # ESTRATÉGIA 4: Script regex fallback
    if not result["date_text"]:
        for script in soup.find_all("script"):
            content = script.get_text() or ""
            for key in ["datePosted", "datePublished", "createdAt", "updatedAt"]:
                m = re.search(rf'"{key}"\s*:\s*"([^"]+)"', content)
                if m:
                    result["date_text"] = m.group(1)
                    result["source"] = f"SCRIPT_REGEX:{key}"
                    break
            if result["date_text"]:
                break
    
    # Converter texto para data
    if result["date_text"]:
        parsed = parse_date_text(result["date_text"])
        result["published_at"] = parsed.get("datetime")
        result["days_ago"] = parsed.get("days_ago")
    
    return result


def _find_key_recursive(obj, key):
    """Busca recursiva por uma chave em objeto JSON."""
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            found = _find_key_recursive(v, key)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _find_key_recursive(item, key)
            if found:
                return found
    return None


def parse_date_text(text: str) -> Dict[str, Any]:
    """
    Parseia texto de data em português brasileiro.
    
    Exemplos:
    - "Publicado há 1 mês, atualizado há 9 horas."
    - "Publicado há 2 semanas"
    - "Anúncio criado em 10 de janeiro de 2026"
    - "2026-01-15T10:30:00Z" (ISO format)
    """
    result = {"datetime": None, "days_ago": None}
    
    if not text:
        return result
    
    # PRIORIDADE 1: Extrair especificamente "Publicado há X tempo"
    # Isso evita pegar "atualizado há" em vez de "publicado há"
    pub_match = re.search(r'Publicado\s+há\s*(\d+)\s*(minuto|hora|dia|semana|m[êe]s|ano)', text, re.I)
    if pub_match:
        val = int(pub_match.group(1))
        unit = pub_match.group(2).lower()
        
        # Normalizar unidade para dias
        multipliers = {
            'minuto': 0, 'hora': 0,  # < 1 dia = 0 dias
            'dia': 1, 'semana': 7,
            'mês': 30, 'mes': 30,  # com/sem acento
            'ano': 365
        }
        
        # Encontrar o multiplicador correto
        for key, mult in multipliers.items():
            if key in unit:
                days = val * mult if mult > 0 else 0
                result["days_ago"] = days
                result["datetime"] = datetime.now(timezone.utc) - timedelta(days=days)
                return result
    
    # PRIORIDADE 2: Tentar ISO format
    iso_match = re.search(r'(\d{4}-\d{2}-\d{2}T[\d:]+(?:Z|[+-]\d{2}:\d{2})?)', text)
    if iso_match:
        try:
            dt_str = iso_match.group(1).replace("Z", "+00:00")
            dt = datetime.fromisoformat(dt_str)
            result["datetime"] = dt
            result["days_ago"] = (datetime.now(timezone.utc) - dt.replace(tzinfo=timezone.utc)).days
            return result
        except:
            pass
    
    # PRIORIDADE 3: Formato extenso brasileiro: "10 de janeiro de 2026"
    months = {
        "janeiro": 1, "fevereiro": 2, "março": 3, "abril": 4,
        "maio": 5, "junho": 6, "julho": 7, "agosto": 8,
        "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12
    }
    
    ext_match = re.search(r'(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})', text, re.I)
    if ext_match:
        day = int(ext_match.group(1))
        month_name = ext_match.group(2).lower()
        year = int(ext_match.group(3))
        month = months.get(month_name)
        if month:
            try:
                dt = datetime(year, month, day, tzinfo=timezone.utc)
                result["datetime"] = dt
                result["days_ago"] = (datetime.now(timezone.utc) - dt).days
                return result
            except:
                pass
    
    # PRIORIDADE 4: Formato relativo genérico (fallback)
    # Ordenar do maior para o menor período para pegar o mais significativo primeiro
    relative_patterns = [
        (r'há\s*(\d+)\s*ano', 365),
        (r'há\s*(\d+)\s*m[êe]s', 30),
        (r'há\s*(\d+)\s*semana', 7),
        (r'há\s*(\d+)\s*dia', 1),
        (r'há\s*(\d+)\s*hora', 0),
        (r'há\s*(\d+)\s*minuto', 0),
    ]
    
    for pattern, multiplier in relative_patterns:
        m = re.search(pattern, text.lower())
        if m:
            val = int(m.group(1))
            days = val * multiplier if multiplier > 0 else 0
            
            result["days_ago"] = max(0, days)
            result["datetime"] = datetime.now(timezone.utc) - timedelta(days=days)
            return result
    
    # Casos especiais
    if re.search(r'\bhoje\b', text.lower()):
        result["days_ago"] = 0
        result["datetime"] = datetime.now(timezone.utc)
        return result
    
    if re.search(r'\bontem\b', text.lower()):
        result["days_ago"] = 1
        result["datetime"] = datetime.now(timezone.utc) - timedelta(days=1)
        return result
    
    return result


# ===========================
# 5. PAGINATION NAVIGATOR
# ===========================
class PaginationNavigator:
    """
    Navegador de paginação com comportamento humano.
    Usa curl_cffi para navegação entre páginas.
    """
    
    def __init__(self, fetcher: AdvancedStealthFetcher):
        self.fetcher = fetcher
        self.current_page = 1
        self.pages_visited = []
    
    async def navigate_to_page(self, base_url: str, page: int) -> Tuple[str, bool]:
        """
        Navega para uma página específica.
        
        Returns:
            Tuple of (html, success)
        """
        # Construir URL com paginação
        separator = "&" if "?" in base_url else "?"
        page_url = f"{base_url}{separator}pagina={page}" if page > 1 else base_url
        
        # Referer é a página anterior (comportamento natural)
        referer = self.pages_visited[-1] if self.pages_visited else base_url.split("?")[0]
        
        # Jitter maior entre páginas (humanos demoram para decidir clicar)
        html, status, meta = await self.fetcher.fetch(
            page_url, 
            referer=referer,
            min_jitter=4.0,  # Mais tempo entre páginas
            max_jitter=8.0
        )
        
        if status == 200 and not meta.get("blocked"):
            self.pages_visited.append(page_url)
            self.current_page = page
            return html, True
        
        return "", False


# ===========================
# 6. COMPLETE EXAMPLE USAGE
# ===========================
async def example_scrape_vivareal():
    """
    Exemplo completo de uso do fetcher avançado para VivaReal.
    """
    fetcher = AdvancedStealthFetcher(impersonate="chrome120")
    
    listing_url = "https://www.vivareal.com.br/venda/sp/campinas/apartamento_residencial/"
    
    try:
        # 1. Fetch da listagem
        print(f"📡 Buscando listagem: {listing_url}")
        html, status, meta = await fetcher.fetch(listing_url)
        
        if meta.get("blocked"):
            print(f"❌ Bloqueado na listagem! Status: {status}")
            return
        
        print(f"✅ Listagem OK - {meta['content_length']} bytes")
        
        # Definir referer base para próximas requisições
        fetcher.set_base_referer(listing_url)
        
        # 2. Parsear cards
        soup = BeautifulSoup(html, "html.parser")
        cards = soup.select('[data-testid="listing-card"], .property-card__container')
        print(f"📊 Encontrados {len(cards)} cards")
        
        # 3. Fetch de detalhes para primeiros 3 cards
        for i, card in enumerate(cards[:3], 1):
            link = card.select_one("a[href*='/imovel/']")
            if not link:
                continue
            
            href = link.get("href", "")
            detail_url = f"https://www.vivareal.com.br{href}" if href.startswith("/") else href
            
            print(f"\n🔍 [{i}/3] Buscando detalhe...")
            detail_html, status, meta = await fetcher.fetch(detail_url, referer=listing_url)
            
            if meta.get("blocked"):
                print(f"   ❌ Bloqueado!")
                continue
            
            # Extrair data de publicação
            date_info = extract_publication_date(detail_html)
            
            if date_info["date_text"]:
                print(f"   ✅ Data: {date_info['date_text']}")
                print(f"   📅 Há {date_info['days_ago']} dias (fonte: {date_info['source']})")
            else:
                print(f"   ⚠️ Data não encontrada")
    
    finally:
        fetcher.close()
        print("\n👋 Sessão encerrada")


# Só executar se for o script principal
if __name__ == "__main__":
    import asyncio
    asyncio.run(example_scrape_vivareal())

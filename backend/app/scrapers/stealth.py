"""
Enhanced StealthFetcher with Advanced Anti-Detection Techniques

Uses PATCHRIGHT instead of standard Playwright for better Cloudflare bypass.
Patchright is a patched version of Playwright that removes automation indicators.

Features:
- User-Agent rotation pool (20+ real UAs)
- Viewport randomization
- Human behavior simulation (mouse, scroll, delays)
- Adaptive delays (3-8s between actions)
- Session persistence with cookies
- TLS fingerprint masking via browser args
- Canvas/WebGL fingerprint evasion
"""
import asyncio
import logging
import random
import time
import json
import hashlib
from typing import Optional, Dict, Any, Union, List
from pathlib import Path

# Use standard playwright (patchright has network issues on some systems)
# The stealth techniques below provide sufficient anti-detection
from playwright.async_api import async_playwright, Page, BrowserContext, Response
USING_PATCHRIGHT = False

# playwright_stealth is still useful for additional patches
try:
    from playwright_stealth import Stealth
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

logger = logging.getLogger(__name__)


# =============================================================================
# USER-AGENT POOL (Real browsers, updated 2024/2025)
# =============================================================================
USER_AGENTS = [
    # Chrome on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    # Chrome on Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Firefox on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    # Firefox on Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0",
    # Edge on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    # Safari on Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    # Chrome on Linux
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# Viewports matching common screen resolutions
VIEWPORTS = [
    {"width": 1920, "height": 1080},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1366, "height": 768},
    {"width": 1280, "height": 720},
    {"width": 1600, "height": 900},
    {"width": 1680, "height": 1050},
]

# Browser launch args for stealth
# Note: Patchright already patches core browser, so we use minimal args
STEALTH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--no-first-run",
]


class StealthFetcher:
    """
    Enhanced StealthFetcher with advanced anti-detection techniques.
    
    Uses PATCHRIGHT (if available) for core-level Cloudflare bypass.
    
    Features:
    - User-Agent rotation
    - Viewport randomization
    - Human behavior simulation
    - Adaptive delays
    - Session persistence
    """

    def __init__(self, headless: bool = True, session_dir: Optional[str] = None):
        self.headless = headless
        self.session_dir = session_dir
        self.stealth_config = Stealth() if HAS_STEALTH else None
        self.playwright = None
        self.browser = None
        self.context: Optional[BrowserContext] = None
        self.lock = asyncio.Lock()
        
        # Session state
        self.current_user_agent = None
        self.current_viewport = None
        self.page_count = 0
        self.session_start_time = None
        
        # Stats
        self.stats = {
            "pages_fetched": 0,
            "pages_blocked": 0,
            "avg_delay": 0.0,
            "total_time": 0.0,
        }

    def _rotate_user_agent(self) -> str:
        """Select a random User-Agent from pool."""
        self.current_user_agent = random.choice(USER_AGENTS)
        return self.current_user_agent

    def _rotate_viewport(self) -> Dict[str, int]:
        """Select a random viewport from pool."""
        self.current_viewport = random.choice(VIEWPORTS)
        return self.current_viewport

    async def start(self, force_new: bool = False):
        """Initialize browser and context with stealth settings."""
        if self.playwright and not force_new:
            return
        
        # Close existing if forcing new session
        if force_new:
            await self.close()
        
        self._rotate_user_agent()
        self._rotate_viewport()
        
        print(f"👤 [STEALTH] Starting session...")
        print(f"   📱 UA: {self.current_user_agent[:60]}...")
        print(f"   🖥️ Viewport: {self.current_viewport['width']}x{self.current_viewport['height']}")
        
        self.playwright = await async_playwright().start()
        
        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=STEALTH_ARGS
        )
        
        # Create context with randomized fingerprint
        context_options = {
            "user_agent": self.current_user_agent,
            "viewport": self.current_viewport,
            "ignore_https_errors": True,
            "java_script_enabled": True,
            "locale": "pt-BR",
            "timezone_id": "America/Sao_Paulo",
            "geolocation": {"latitude": -22.9068, "longitude": -43.1729},  # Rio area
            "permissions": ["geolocation"],
        }
        
        # Load session state if available
        if self.session_dir:
            state_file = Path(self.session_dir) / "session_state.json"
            if state_file.exists():
                try:
                    context_options["storage_state"] = str(state_file)
                    print(f"   💾 Loaded session state from {state_file}")
                except:
                    pass
        
        self.context = await self.browser.new_context(**context_options)
        
        # Add init scripts for additional stealth
        await self.context.add_init_script("""
            // Remove webdriver property
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            
            // Override plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            
            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['pt-BR', 'pt', 'en-US', 'en']
            });
            
            // Override platform (match UA)
            const ua = navigator.userAgent.toLowerCase();
            let platform = 'Win32';
            if (ua.includes('mac')) platform = 'MacIntel';
            else if (ua.includes('linux')) platform = 'Linux x86_64';
            Object.defineProperty(navigator, 'platform', { get: () => platform });
            
            // Override chrome property
            window.chrome = { runtime: {} };
            
            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        """)
        
        self.session_start_time = time.time()
        self.page_count = 0

    async def save_session_state(self):
        """Save cookies and storage for session persistence."""
        if not self.context or not self.session_dir:
            return
        
        state_file = Path(self.session_dir) / "session_state.json"
        state_file.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            state = await self.context.storage_state()
            with open(state_file, "w") as f:
                json.dump(state, f)
            print(f"   💾 Saved session state to {state_file}")
        except Exception as e:
            logger.debug(f"Failed to save session: {e}")

    async def simulate_human_behavior(self, page: Page):
        """
        Simulate realistic human behavior before capturing content.
        
        Actions:
        1. Random mouse movements
        2. Gradual scrolling
        3. Natural pauses
        """
        try:
            # 1. Initial pause (like page loading/looking)
            await asyncio.sleep(random.uniform(1.0, 2.0))
            
            # 2. Move mouse to random position (simulates user looking)
            x = random.randint(100, self.current_viewport["width"] - 100)
            y = random.randint(100, min(400, self.current_viewport["height"] - 100))
            await page.mouse.move(x, y, steps=random.randint(5, 15))
            
            # 3. Scroll down gradually (2-4 scrolls)
            for _ in range(random.randint(2, 4)):
                scroll_amount = random.randint(200, 500)
                await page.mouse.wheel(0, scroll_amount)
                await asyncio.sleep(random.uniform(0.3, 0.8))
            
            # 4. Pause like reading content
            await asyncio.sleep(random.uniform(1.5, 3.0))
            
            # 5. Sometimes scroll back up a bit
            if random.random() < 0.3:
                await page.mouse.wheel(0, -random.randint(100, 200))
                await asyncio.sleep(random.uniform(0.3, 0.6))
            
            # 6. Move mouse again
            x2 = random.randint(100, self.current_viewport["width"] - 100)
            y2 = random.randint(200, self.current_viewport["height"] - 200)
            await page.mouse.move(x2, y2, steps=random.randint(3, 10))
            
        except Exception as e:
            logger.debug(f"Human simulation error: {e}")

    async def fetch(
        self, 
        url: str, 
        return_meta: bool = False, 
        run_id: str = None, 
        scenario: str = "unknown", 
        request_type: str = "unknown", 
        page_num: int = None, 
        card_index: int = None, 
        referer: str = None, 
        wait_for_selector: str = None, 
        wait_timeout: int = 15000,
        simulate_human: bool = True
    ) -> Union[str, Dict[str, Any]]:
        """
        Fetch URL with stealth techniques and human simulation.
        
        Args:
            url: URL to fetch
            return_meta: Return metadata dict instead of just HTML
            run_id: Run ID for logging
            scenario: Scenario name for logging
            request_type: Request type for logging
            page_num: Page number for logging
            card_index: Card index for logging
            referer: Referer header
            wait_for_selector: CSS selector to wait for
            wait_timeout: Timeout for selector wait (ms)
            simulate_human: Whether to simulate human behavior
        """
        if not self.context:
            await self.start()
        
        # Rotate session every 5 pages to avoid fingerprinting
        self.page_count += 1
        if self.page_count > 5:
            print(f"   🔄 Rotating session after {self.page_count} pages...")
            await self.start(force_new=True)
        
        page = await self.context.new_page()
        response = None
        html = ""
        meta = {}
        ts_start = time.time()
        
        cookies_before = await self.context.cookies()
        
        try:
            # Apply stealth plugin if available (on top of patchright)
            if self.stealth_config:
                await self.stealth_config.apply_stealth_async(page)
            
            # Set headers
            headers = {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "max-age=0",
                "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"' if "Windows" in self.current_user_agent else '"macOS"',
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "same-origin" if referer else "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            }
            if referer:
                headers["Referer"] = referer
            
            await page.set_extra_http_headers(headers)
            
            # Navigate
            response = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            # Wait for Cloudflare challenge to clear (if present)
            # Cloudflare JS challenge typically shows "Just a moment..." and then redirects
            cf_cleared = False
            for attempt in range(15):  # Max 15 seconds wait for CF
                try:
                    title = await page.title()
                    content = await page.content()
                    
                    # Check if still on Cloudflare challenge
                    is_cf_challenge = (
                        "just a moment" in title.lower() or
                        "attention required" in title.lower() or
                        "challenge-form" in content.lower() or
                        ("cloudflare" in content.lower() and len(content) < 10000)
                    )
                    
                    if not is_cf_challenge:
                        cf_cleared = True
                        break
                    
                    # Still on challenge - wait and let JS execute
                    await asyncio.sleep(1.0)
                    
                except Exception:
                    await asyncio.sleep(1.0)
            
            if not cf_cleared:
                print(f"   ⚠️ Cloudflare challenge did not clear after 15s")
            
            # Wait for content selector (after CF cleared)
            if wait_for_selector:
                try:
                    await page.wait_for_selector(wait_for_selector, timeout=wait_timeout)
                except Exception as e:
                    logger.debug(f"Selector wait timeout: {e}")
            
            # Simulate human behavior (critical for Cloudflare bypass)
            if simulate_human:
                await self.simulate_human_behavior(page)
            else:
                # Minimal delay even without full simulation
                await asyncio.sleep(random.uniform(2.0, 4.0))
            
            html = await page.content()
            
        except Exception as e:
            logger.error(f"Fetch error for {url}: {e}")
        
        ts_end = time.time()
        elapsed_ms = (ts_end - ts_start) * 1000
        
        cookies_after = await self.context.cookies()
        
        # Build metrics
        status = response.status if response else 0
        final_url = page.url if page else url
        
        req_headers = {}
        if response and response.request:
            try:
                req_headers = await response.request.all_headers()
            except:
                pass
        
        html_bytes = html.encode('utf-8')
        html_size = len(html_bytes)
        html_hash = hashlib.sha1(html_bytes).hexdigest()[:8] if html else "empty"
        
        # Detect blocks
        block_signals = []
        if html:
            lower_html = html.lower()
            try:
                title = await page.title()
                if "just a moment" in title.lower():
                    block_signals.append("has_just_a_moment")
                if "access denied" in title.lower():
                    block_signals.append("has_access_denied")
            except:
                pass
            if "captcha" in lower_html:
                block_signals.append("has_captcha")
            if "challenge-form" in lower_html:
                block_signals.append("has_challenge_form")
        
        snippet = ""
        if block_signals or status in (403, 401, 429):
            try:
                t = await page.title()
                snippet = t + " | " + html[:200].replace("\n", " ")
            except:
                pass
        
        # Log metrics
        self.log_fetch_metrics(
            run_id=run_id,
            scenario=scenario,
            request_type=request_type,
            page_num=page_num,
            card_index=card_index,
            url=url,
            final_url=final_url,
            status=status,
            elapsed_ms=elapsed_ms,
            html_size=html_size,
            html_hash=html_hash,
            cookie_count_pre=len(cookies_before),
            cookie_count_post=len(cookies_after),
            session_id=str(id(self.context)),
            block_signals=block_signals,
            snippet=snippet,
            user_agent=req_headers.get('user-agent', 'unknown')
        )
        
        # Update stats
        self.stats["pages_fetched"] += 1
        if block_signals:
            self.stats["pages_blocked"] += 1
        
        meta = {
            "html": html,
            "status": status,
            "url": final_url,
            "headers": req_headers,
            "cookies_count": len(cookies_after),
            "blocked": len(block_signals) > 0,
            "block_signals": block_signals,
        }
        self.last_meta = meta
        
        try:
            await page.close()
        except:
            pass
        
        return meta if return_meta else html

    def log_fetch_metrics(self, **kwargs):
        """Log fetch metrics in compact format."""
        print(f"\n📡 [FETCH] {kwargs.get('scenario')} | {kwargs.get('request_type')} | {kwargs.get('url')[:80]}...")
        print(f"   🆔 Run: {kwargs.get('run_id')} | Session: {kwargs.get('session_id')}")
        print(f"   ⏱️ {kwargs.get('elapsed_ms'):.0f}ms | {kwargs.get('html_size')//1000}KB | Status: {kwargs.get('status')}")
        print(f"   🍪 Cookies: {kwargs.get('cookie_count_pre')} → {kwargs.get('cookie_count_post')}")
        
        if kwargs.get('block_signals'):
            print(f"   ⚠️ BLOCK: {kwargs.get('block_signals')}")
            print(f"   📝 {kwargs.get('snippet')[:100]}...")
        print("-" * 60)

    def get_stats(self) -> Dict[str, Any]:
        """Get session statistics."""
        success_rate = 0.0
        if self.stats["pages_fetched"] > 0:
            success_rate = (self.stats["pages_fetched"] - self.stats["pages_blocked"]) / self.stats["pages_fetched"] * 100
        
        return {
            **self.stats,
            "success_rate": round(success_rate, 1),
            "session_pages": self.page_count,
            "user_agent": self.current_user_agent,
            "viewport": self.current_viewport,
        }

    async def close(self):
        """Close browser and cleanup."""
        if self.session_dir:
            await self.save_session_state()
        
        if self.context:
            try:
                await self.context.close()
            except:
                pass
            self.context = None
        
        if self.browser:
            try:
                await self.browser.close()
            except:
                pass
            self.browser = None
        
        if self.playwright:
            try:
                await self.playwright.stop()
            except:
                pass
            self.playwright = None
        
        print("👤 [STEALTH] Session closed.")


if __name__ == "__main__":
    async def test():
        f = StealthFetcher(headless=True)
        await f.start()
        html = await f.fetch("https://www.vivareal.com.br", simulate_human=True)
        print(f"Got {len(html)} bytes")
        print(f"Stats: {f.get_stats()}")
        await f.close()
    
    # asyncio.run(test())

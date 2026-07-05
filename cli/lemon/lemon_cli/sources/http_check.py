"""HTTP probing of Caddy via localhost:80 with Host header (skips Cloudflare)."""
import socket
import time
import urllib.error
import urllib.request
from typing import Optional

from .. import config


def _probe(
    host: str,
    *,
    path: str = "/",
    follow: bool = False,
    max_hops: int = 5,
    timeout: float = 5.0,
    target: str = "http://127.0.0.1:80",
) -> dict:
    """Hit Caddy on localhost with a Host header. Returns full probe result."""
    chain: list[dict] = []
    url = target.rstrip("/") + path
    cur_host = host
    body = b""
    final_status: Optional[int] = None
    final_url = url
    final_host = cur_host
    error: Optional[str] = None
    start = time.monotonic()

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **kw):
            return None

    opener = urllib.request.build_opener(_NoRedirect)

    for hop in range(max_hops + 1):
        req = urllib.request.Request(url, headers={"Host": cur_host, "User-Agent": "lemon-cli/1.0"})
        config.dbg(f"http {url}  Host={cur_host}")
        try:
            with opener.open(req, timeout=timeout) as resp:
                final_status = resp.status
                body = resp.read(2048)
                chain.append({
                    "url": url, "host": cur_host, "status": resp.status,
                    "location": resp.headers.get("Location"),
                })
                break
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location") if e.headers else None
            chain.append({"url": url, "host": cur_host, "status": e.code, "location": loc})
            final_status = e.code
            if follow and 300 <= e.code < 400 and loc and hop < max_hops:
                # Resolve relative
                if loc.startswith("http://") or loc.startswith("https://"):
                    # Extract host from absolute URL but still route through Caddy
                    from urllib.parse import urlparse
                    p = urlparse(loc)
                    cur_host = p.netloc
                    url = target.rstrip("/") + (p.path or "/") + (
                        "?" + p.query if p.query else ""
                    )
                else:
                    url = target.rstrip("/") + loc
                final_url = url
                final_host = cur_host
                continue
            try:
                body = e.read(2048) or b""
            except Exception:
                body = b""
            break
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as e:
            error = str(e)
            break

    elapsed_ms = int((time.monotonic() - start) * 1000)

    auth_redirect = False
    for h in chain:
        loc = (h.get("location") or "").lower()
        if (
            "outpost.goauthentik.io" in loc
            or f"auth.{config.DOMAIN}" in loc
            or f"auth2.{config.DOMAIN}" in loc
        ):
            auth_redirect = True
            break

    return {
        "host": host,
        "status": final_status,
        "final_url": final_url,
        "final_host": final_host,
        "redirect_chain": chain,
        "auth_redirect": auth_redirect,
        "body_preview": body[:200].decode("utf-8", errors="replace") if body else "",
        "elapsed_ms": elapsed_ms,
        "error": error,
    }


def smoke(host: str, path: str = "/", follow: bool = True) -> dict:
    return _probe(host, path=path, follow=follow)


def probe_no_follow(host: str, path: str = "/") -> dict:
    return _probe(host, path=path, follow=False)


def authentik_outpost_reachable() -> bool:
    """Cheap GET against the authentik outpost at localhost:9000."""
    try:
        req = urllib.request.Request("http://127.0.0.1:9000/-/health/live/")
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            return resp.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except Exception as e:
        config.dbg(f"authentik outpost probe failed: {e}")
        return False

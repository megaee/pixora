"""Command line entry point: `pixora [FOLDER]` (or `photo-cleanup`) starts the web app."""

from __future__ import annotations

import argparse
import threading
import webbrowser

import uvicorn

from .api import STATIC_DIR, create_app


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Pixora: your photos, beautifully sorted.")
    ap.add_argument("folder", nargs="?", help="photo folder to open on start (optional)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true", help="don't open a browser window")
    args = ap.parse_args(argv)

    app = create_app(folder=args.folder)
    url = f"http://{args.host}:{args.port}/"
    if not (STATIC_DIR / "index.html").exists():
        print("Note: UI not built yet. Run `make build` (or use `make dev` for development).")
    print(f"Pixora running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

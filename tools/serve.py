"""Open the bundled, offline BPX simulator on a loopback-only HTTP server."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from threading import Timer
from urllib.request import urlopen
import webbrowser

site = Path(__file__).resolve().parents[1] / "dist"
if not (site / "index.html").exists():
    sys.exit("请先在 BPX-Studio 目录运行 npm run build。")

class Viewer(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".glb": "model/gltf-binary", ".webp": "image/webp"}
    def end_headers(self):
        self.send_header("X-BPX-Project", "black-panther-x")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

launch_browser = "--no-browser" not in sys.argv
for port in range(5318, 5330):
    url = f"http://127.0.0.1:{port}/"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), partial(Viewer, directory=str(site)))
        break
    except OSError:
        try:
            with urlopen(url, timeout=0.8) as reply:
                if reply.headers.get("X-BPX-Project") == "black-panther-x":
                    if launch_browser:
                        webbrowser.open(url)
                    print(url, flush=True)
                    sys.exit(0)
        except OSError:
            pass
else:
    sys.exit("未找到可用的本地端口。")

print(f"BPX Studio  {url}\n关闭此窗口可结束预览。", flush=True)
if launch_browser:
    Timer(0.4, webbrowser.open, args=(url,)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()

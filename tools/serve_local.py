import functools
import http.server
import sys

folder = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(NoCache, directory=folder)).serve_forever()

#!/usr/bin/env python3
"""Static file server for BLACKWAKE with caching disabled (so edits show up on reload)."""
import http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{'.js': 'text/javascript'})
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8417
    print('BLACKWAKE on http://127.0.0.1:%d' % port)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()

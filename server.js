const http = require('http');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const fs = require('fs/promises');
const { stream } = require('undici');
const { marked } = require('marked');

const PORT = process.env.PORT || 8080;

/**
 * Ghi log theo định dạng Nginx access log.
 */
function accessLog(req, res, contentLength) {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const date = new Date().toUTCString();
    const method = req.method;
    const url = req.url;
    const httpVersion = `HTTP/${req.httpVersion}`;
    const status = res.statusCode;
    const referer = req.headers['referer'] || '-';
    const userAgent = req.headers['user-agent'] || '-';

    console.log(
        `${clientIp} - - [${date}] "${method} ${url} ${httpVersion}" ${status} ${contentLength || '-'} "${referer}" "${userAgent}"`
    );
}

/**
 * Render trang hướng dẫn.
 */
async function serveInstructions(res) {
    try {
        const markdown = await fs.readFile('README.md', 'utf8');
        const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HTTP Streaming Forward Proxy</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; margin: 2rem; max-width: 800px; margin: 2rem auto; }
          code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 4px; }
          pre { background-color: #f4f4f4; padding: 1rem; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; }
        </style>
      </head>
      <body>
        ${marked(markdown)}
      </body>
      </html>
    `;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return Buffer.byteLength(html);
    } catch (err) {
        console.error("Could not read README.md", err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return 21;
    }
}

/**
 * Xử lý proxy request.
 */
function handleProxy(req, res, targetUrl) {
    return new Promise((resolve, reject) => {
        try {
            new URL(targetUrl);
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid target URL provided in the "url" query parameter.');
            return resolve(58);
        }

        const forwardedHeaders = { ...req.headers };
        delete forwardedHeaders.host;

        let responseBodyLength = 0;

        stream(
            targetUrl,
            {
                method: req.method,
                headers: forwardedHeaders,
                body: (req.method !== 'GET' && req.method !== 'HEAD') ? Readable.from(req) : null,
            },
            ({ statusCode, headers, body }) => {
                delete headers['content-encoding'];
                delete headers['transfer-encoding'];
                delete headers['connection'];
                res.writeHead(statusCode, headers);

                if (body) {
                    body.on('data', (chunk) => {
                        responseBodyLength += chunk.length;
                    });
                    pipeline(body, res)
                        .then(() => resolve(responseBodyLength))
                        .catch(err => {
                            console.error('Error during response pipeline:', err.message);
                            if (!res.writableEnded) res.end();
                            reject(err);
                        });
                } else {
                    res.end();
                    resolve(0);
                }
            }
        ).catch(err => {
            console.error('Proxy Error:', err.message);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Bad Gateway: ${err.message}`);
            } else if (!res.writableEnded) {
                res.end();
            }
            reject(err);
        });
    });
}

const server = http.createServer(async (req, res) => {
    let contentLength = 0;
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const targetUrl = requestUrl.searchParams.get('url');

    try {
        if (targetUrl) {
            contentLength = await handleProxy(req, res, targetUrl);
        } else {
            contentLength = await serveInstructions(res);
        }
    } catch (error) {
        if (!res.writableEnded) {
            res.end();
        }
    } finally {
        accessLog(req, res, contentLength);
    }
});

server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

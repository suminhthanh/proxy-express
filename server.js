const http = require('http');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const fs = require('fs');
const { stream, getGlobalDispatcher } = require('undici');
const { marked } = require('marked');

const PORT = process.env.PORT || 8080;

/**
 * Ghi log theo định dạng Nginx access log (combined format).
 * @param {http.IncomingMessage} req - Đối tượng request.
 * @param {http.ServerResponse} res - Đối tượng response.
 * @param {number} contentLength - Kích thước nội dung response.
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
 * Render trang hướng dẫn sử dụng từ file README.md.
 * @param {http.ServerResponse} res - Đối tượng response.
 */
function serveInstructions(res) {
    fs.readFile('README.md', 'utf8', (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error: Could not read README.md');
            accessLog({ url: '/', method: 'GET', headers: {}, socket: { remoteAddress: 'unknown' } }, res, 0);
            return;
        }
        const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HTTP Streaming Forward Proxy</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; margin: 2rem; }
          code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 4px; }
          pre { background-color: #f4f4f4; padding: 1rem; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; }
        </style>
      </head>
      <body>
        ${marked(data)}
      </body>
      </html>
    `;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        accessLog({ url: '/', method: 'GET', headers: {}, socket: { remoteAddress: 'unknown' } }, res, Buffer.byteLength(html));
    });
}

/**
 * Xử lý proxy request.
 * @param {http.IncomingMessage} req - Đối tượng request.
 * @param {http.ServerResponse} res - Đối tượng response.
 */
async function handleProxy(req, res) {
    const targetUrl = req.url.slice(1); // Bỏ dấu "/" ở đầu

    // Kiểm tra URL hợp lệ
    try {
        new URL(targetUrl);
    } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid target URL provided.');
        accessLog(req, res, 0);
        return;
    }

    // Sao chép headers, loại bỏ header "host" để undici tự động thiết lập
    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders.host;

    let responseBodyLength = 0;

    try {
        await stream(
            targetUrl,
            {
                method: req.method,
                headers: forwardedHeaders,
                body: Readable.from(req), // Truyền streaming body của request
                opaque: { res, req }, // Truyền response và request gốc vào opaque để sử dụng trong callback
            },
            ({ statusCode, headers, body }) => {
                // Xóa các header liên quan đến compression và chunking để tránh xung đột
                delete headers['content-encoding'];
                delete headers['transfer-encoding'];
                delete headers['connection'];

                res.writeHead(statusCode, headers);

                // Đếm kích thước response body
                body.on('data', (chunk) => {
                    responseBodyLength += chunk.length;
                });

                return pipeline(body, res);
            }
        );
    } catch (error) {
        console.error('Proxy Error:', error.message);
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Bad Gateway: ${error.message}`);
        }
    } finally {
        accessLog(req, res, responseBodyLength);
    }
}

// Tạo HTTP server
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        serveInstructions(res);
    } else {
        handleProxy(req, res);
    }
});

server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
    console.log('Serving instructions at http://localhost:8080/');
    console.log('Proxy endpoint: http://localhost:8080/<full-target-url>');
});

// Xử lý graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

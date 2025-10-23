const http = require('http');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const fs = require('fs');
const { stream } = require('undici');
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
            accessLog({ url: '/', method: 'GET', headers: {}, socket: { remoteAddress: 'unknown' }, httpVersion: '1.1' }, res, 0);
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
        accessLog({ url: '/', method: 'GET', headers: {}, socket: { remoteAddress: 'unknown' }, httpVersion: '1.1' }, res, Buffer.byteLength(html));
    });
}

/**
 * Xử lý proxy request.
 * @param {http.IncomingMessage} req - Đối tượng request.
 * @param {http.ServerResponse} res - Đối tượng response.
 */
async function handleProxy(req, res) {
    const targetUrl = req.url.slice(1);

    try {
        new URL(targetUrl);
    } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid target URL provided.');
        accessLog(req, res, 28);
        return;
    }

    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders.host;

    let responseBodyLength = 0;

    try {
        await stream(
            targetUrl,
            {
                method: req.method,
                headers: forwardedHeaders,
                body: (req.method !== 'GET' && req.method !== 'HEAD') ? Readable.from(req) : null,
                opaque: { res, req },
            },
            ({ statusCode, headers, body }) => {
                delete headers['content-encoding'];
                delete headers['transfer-encoding'];
                delete headers['connection'];

                res.writeHead(statusCode, headers);
                
                // === SỬA LỖI TẠI ĐÂY ===
                // Kiểm tra nếu response từ server đích có body thì mới pipeline
                if (body) {
                    body.on('data', (chunk) => {
                        responseBodyLength += chunk.length;
                    });
                    return pipeline(body, res);
                } else {
                    // Nếu không có body (ví dụ 204 No Content), chỉ cần kết thúc response
                    res.end();
                }
            }
        );
    } catch (error) {
        console.error('Proxy Error:', error.message);
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Bad Gateway: ${error.message}`);
        } else {
            // Nếu header đã được gửi, có thể stream đã bị lỗi giữa chừng
            res.end();
        }
    } finally {
        // Luôn ghi log sau khi request kết thúc
        accessLog(req, res, responseBodyLength);
    }
}

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

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

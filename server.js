const http = require('http');
const fs = require('fs/promises');
const { request } = require('undici'); // Sử dụng 'request' thay vì 'stream'
const { marked } = require('marked');

const PORT = process.env.PORT || 8080;

// Hàm đọc toàn bộ body của một request đến
function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        const bodyChunks = [];
        req.on('data', chunk => {
            bodyChunks.push(chunk);
        });
        req.on('end', () => {
            resolve(Buffer.concat(bodyChunks));
        });
        req.on('error', err => {
            reject(err);
        });
    });
}

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
        <title>HTTP Forward Proxy</title>
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
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return 21;
    }
}

/**
 * Xử lý proxy request (phiên bản non-streaming).
 */
async function handleProxy(req, res) {
    const targetUrl = req.url.slice(1);

    try {
        new URL(targetUrl);
    } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid target URL provided.');
        return 28;
    }

    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders.host;

    try {
        // 1. Đệm toàn bộ request body từ client
        const requestBody = await getRequestBody(req);

        // 2. Gửi request đã được đệm đến server đích
        const {
            statusCode,
            headers: responseHeaders,
            body: responseBodyStream
        } = await request(targetUrl, {
            method: req.method,
            headers: forwardedHeaders,
            body: requestBody.length > 0 ? requestBody : null,
        });

        // 3. Đệm toàn bộ response body từ server đích
        const responseBody = await responseBodyStream.arrayBuffer();
        const responseBuffer = Buffer.from(responseBody);
        
        // Dọn dẹp headers và set Content-Length chính xác
        // delete responseHeaders['content-encoding'];
        delete responseHeaders['transfer-encoding'];
        delete responseHeaders['connection'];
        responseHeaders['content-length'] = responseBuffer.length;

        // 4. Gửi response đã được đệm về cho client
        res.writeHead(statusCode, responseHeaders);
        res.end(responseBuffer);

        return responseBuffer.length;
    } catch (err) {
        console.error('Proxy Error:', err.message);
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Bad Gateway: ${err.message}`);
        } else {
            res.end();
        }
        return 0;
    }
}

const server = http.createServer(async (req, res) => {
    let contentLength = 0;
    try {
        if (req.url === '/') {
            contentLength = await serveInstructions(res);
        } else {
            contentLength = await handleProxy(req, res);
        }
    } catch (error) {
        console.error("Unhandled error in request handler:", error);
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

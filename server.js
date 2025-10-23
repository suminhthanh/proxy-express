const http = require('http');
const fs = require('fs/promises');
const { request } = require('undici');
const { marked } = require('marked');

const PORT = process.env.PORT || 8080;

function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        const bodyChunks = [];
        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(bodyChunks)));
        req.on('error', err => reject(err));
    });
}

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

async function handleProxy(req, res, targetUrl) {
    try {
        new URL(targetUrl);
    } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid target URL provided in "url" parameter.');
        return 51;
    }

    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders.host;

    try {
        const requestBody = await getRequestBody(req);
        const {
            statusCode,
            headers: responseHeaders,
            body: responseBodyStream
        } = await request(targetUrl, {
            method: req.method,
            headers: forwardedHeaders,
            body: requestBody.length > 0 ? requestBody : null,
        });

        const responseBuffer = Buffer.from(await responseBodyStream.arrayBuffer());
        
        delete responseHeaders['transfer-encoding'];
        delete responseHeaders['connection'];
        responseHeaders['content-length'] = responseBuffer.length;

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
    // === THAY ĐỔI CHÍNH NẰM Ở ĐÂY ===
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    let targetUrl = requestUrl.searchParams.get('url');

    let contentLength = 0;
    try {
        if (targetUrl) {
            // Tự động thêm https:// nếu URL không có scheme
            if (!/^https?:\/\//.test(targetUrl)) {
                targetUrl = 'https://' + targetUrl;
            }
            contentLength = await handleProxy(req, res, targetUrl);
        } else {
            // Nếu không có param 'url', hiển thị trang hướng dẫn
            contentLength = await serveInstructions(res);
        }
    } catch (error) {
        console.error("Unhandled error in request handler:", error);
        if (!res.writableEnded) res.end();
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

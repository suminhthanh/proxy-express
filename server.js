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
 * Render trang hướng dẫn và trả về độ dài nội dung.
 * @returns {Promise<number>} Độ dài nội dung HTML.
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
 * Xử lý proxy request và trả về độ dài nội dung response.
 * @returns {Promise<number>} Độ dài nội dung response.
 */
function handleProxy(req, res) {
    // === SỬA LỖI LỚN: BỌC TOÀN BỘ LOGIC VÀO MỘT PROMISE ===
    // Điều này đảm bảo chúng ta chỉ resolve khi stream đã kết thúc hoàn toàn.
    return new Promise((resolve, reject) => {
        const targetUrl = req.url.slice(1);

        try {
            new URL(targetUrl);
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid target URL provided.');
            return resolve(28); // Trả về độ dài của chuỗi lỗi
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
                    // pipeline trả về một promise, chúng ta chờ nó hoàn thành
                    pipeline(body, res)
                        .then(() => resolve(responseBodyLength))
                        .catch(err => {
                            console.error('Error during response pipeline:', err.message);
                            // Nếu có lỗi khi đang stream, kết thúc response và reject promise
                            if (!res.writableEnded) {
                                res.end();
                            }
                            reject(err);
                        });
                } else {
                    res.end();
                    resolve(0); // Không có body, độ dài là 0
                }
            }
        ).catch(err => {
            // Bắt lỗi từ chính undici.stream (ví dụ: không thể kết nối)
            console.error('Proxy Error:', err.message);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Bad Gateway: ${err.message}`);
            } else if (!res.writableEnded) {
                res.end();
            }
            // Reject promise để khối catch bên ngoài có thể xử lý
            reject(err);
        });
    });
}

// === TÁI CẤU TRÚC SERVER ĐỂ XỬ LÝ LỖI VÀ LOGGING TỐT HƠN ===
const server = http.createServer(async (req, res) => {
    let contentLength = 0;
    try {
        if (req.url === '/') {
            contentLength = await serveInstructions(res);
        } else {
            contentLength = await handleProxy(req, res);
        }
    } catch (error) {
        // Bắt các lỗi đã bị reject từ handleProxy
        if (!res.writableEnded) {
            res.end();
        }
    } finally {
        // Luôn ghi log sau khi mọi thứ đã kết thúc (thành công hoặc thất bại)
        accessLog(req, res, contentLength);
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

const express = require("express");
const { request } = require("undici");
const morgan = require("morgan");
const showdown = require("showdown");

const app = express();
const md = new showdown.Converter();

// ✅ Logging dạng Nginx
morgan.token("remote-addr", (req) => req.headers["x-forwarded-for"] || req.ip);
morgan.token("target", (req) => req.originalUrl.slice(1));
app.use(
  morgan(':remote-addr - [:date[iso]] ":method :url" -> ":target" :status :response-time ms ":user-agent"')
);

// ✅ Trang / Hello Markdown Guide
app.get("/", (req, res) => {
  const markdown = `
# 🌐 HTTP Streaming Forward Proxy

Forward mọi request từ **A → B** (giữ nguyên headers, body, method)

---

## ✅ Cách sử dụng

Chỉ cần truyền URL target sau dấu "/":

\`\`\`
http://<proxy-host>/https://senlyzer.com/webhook
\`\`\`

Hỗ trợ:
- GET / POST / PUT / PATCH / DELETE
- JSON / Form-data / File upload
- Streaming download (video / file lớn)
- Forward status code & headers

---

## 🔥 Ví dụ

\`\`\`
curl -X POST http://<proxy>/https://httpbin.org/post \\
  -H "Content-Type: application/json" \\
  -d '{"hello": "world"}'
\`\`\`
`;
  res.setHeader("Content-Type", "text/html");
  res.send(md.makeHtml(markdown));
});

// ✅ Không parse body → giữ nguyên streaming
app.use((req, res, next) => {
  req.setEncoding(null);
  next();
});

// ✅ Catch-all forwarder (phải đứng cuối!)
app.use(async (req, res) => {
  const target = req.originalUrl.slice(1);

  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    return res.redirect("/");
  }

  console.log(`🚀 Streaming Forward → ${target}`);

  try {
    const upstream = await request(target, {
      method: req.method,
      headers: { ...req.headers, host: undefined },
      body: req,
      throwOnError: false,
    });

    res.status(upstream.statusCode);
    for (const [key, value] of Object.entries(upstream.headers)) {
      try { res.setHeader(key, value); } catch {}
    }
    upstream.body.pipe(res);
  } catch (err) {
    console.error("❌ Proxy Error:", err.message);
    res.status(500).send("Forward failed: " + err.message);
  }
});

app.listen(80, () =>
  console.log("✅ Streaming Forward Proxy is running on port 80")
);

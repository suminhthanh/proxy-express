const express = require("express");
const { request } = require("undici");
const morgan = require("morgan");

const app = express();

// ✅ Logging đẹp kiểu Nginx
morgan.token("remote-addr", (req) => req.headers["x-forwarded-for"] || req.ip);
morgan.token("target", (req) => req.originalUrl.slice(1));
app.use(
  morgan(':remote-addr - [:date[iso]] ":method :url" -> ":target" :status :response-time ms ":user-agent"')
);

// ✅ Không dùng body-parser → giữ nguyên streaming body
app.use((req, res, next) => {
  req.setEncoding(null);
  next();
});

app.all("/*", async (req, res) => {
  const target = req.originalUrl.slice(1); // Bỏ dấu "/"

  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    return res.status(400).send("Invalid target URL");
  }

  console.log(`🚀 Stream Forward → ${target}`);

  try {
    const upstream = await request(target, {
      method: req.method,
      headers: {
        ...req.headers,
        host: undefined, // tránh override host
      },
      body: req,
      throwOnError: false,
    });

    // ✅ Forward status + headers từ server đích về client
    res.status(upstream.statusCode);
    for (const [key, value] of Object.entries(upstream.headers)) {
      try {
        res.setHeader(key, value);
      } catch {}
    }

    // ✅ Streaming response trực tiếp
    upstream.body.pipe(res);
  } catch (err) {
    console.error("❌ Proxy Error:", err.message);
    res.status(500).send("Forward failed: " + err.message);
  }
});

app.listen(80, () =>
  console.log("✅ Streaming Forwarder running on port 80")
);

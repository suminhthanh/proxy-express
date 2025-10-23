import express from "express";
import axios from "axios";

const app = express();

// Dùng raw body để đảm bảo không mất dữ liệu
app.use(express.raw({ type: "*/*", limit: "50mb" }));

app.all("/*", async (req, res) => {
  try {
    // Lấy path sau domain, ví dụ: /https://senlyzer.com/webhook-test/abc/xyz
    const target = req.originalUrl.slice(1); // Bỏ dấu "/"

    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      return res.status(400).send("Invalid target URL");
    }

    console.log(`Forwarding → ${target}`);

    // Forward toàn bộ
    const response = await axios({
      url: target,
      method: req.method,
      headers: {
        ...req.headers,
        host: undefined, // tránh overwrite
      },
      data: req.body.length ? req.body : undefined,
      validateStatus: () => true, // tránh lỗi do status code khác 2xx
    });

    // Forward lại response từ server đích
    res.status(response.status);
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
    res.send(response.data);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Forward failed: " + err.message);
  }
});

app.listen(80, () => console.log("🚀 Forwarder listening on port 80"));

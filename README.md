# HTTP Streaming Forward Proxy

Đây là một máy chủ proxy chuyển tiếp HTTP được xây dựng bằng Node.js và `undici`, chạy trong một container Docker duy nhất.

## Hướng dẫn sử dụng

Để sử dụng proxy, hãy truy cập URL theo cấu trúc sau:

```
/<full-target-url>
```

Trong đó `<full-target-url>` là URL đầy đủ của đích đến bạn muốn proxy.

### Ví dụ

1.  **GET Request:**
    Để gửi một request `GET` đến `https://api.github.com/users/octocat`, bạn hãy truy cập:
    ```
    http://localhost:8080/https://api.github.com/users/octocat
    ```

2.  **POST Request với cURL:**
    Bạn có thể sử dụng các công cụ như `cURL` để gửi các loại request khác nhau. Lệnh sau sẽ gửi một request `POST` đến `https://httpbin.org/post` thông qua proxy:

    ```bash
    curl -X POST \
      -H "Content-Type: application/json" \
      -d '{"key": "value"}' \
      http://localhost:8080/https://httpbin.org/post
    ```

### Tính năng

- **Streaming:** Chuyển tiếp cả request và response body dưới dạng stream, hiệu quả cho các tệp lớn.
- **Hỗ trợ mọi phương thức HTTP:** `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, v.v.
- **Forward Headers:** Tất cả các header từ client sẽ được chuyển tiếp đến máy chủ đích.
- **Logging:** Ghi log truy cập theo định dạng của Nginx.
- **Containerized:** Dễ dàng triển khai và chạy với Docker.

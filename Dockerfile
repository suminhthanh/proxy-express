# Sử dụng base image Node.js phiên bản 18.20-alpine cho dung lượng nhẹ
FROM node:18.20-alpine

# Thiết lập thư mục làm việc bên trong container
WORKDIR /usr/src/app

# Sao chép tệp package.json và package-lock.json để cài đặt dependencies
# Tận dụng caching của Docker, bước này chỉ chạy lại khi có sự thay đổi trong 2 tệp này
COPY package*.json ./

# Cài đặt các gói phụ thuộc
RUN npm install

# Sao chép toàn bộ mã nguồn của ứng dụng vào thư mục làm việc
COPY . .

# Mở cổng 8080 để container có thể nhận request từ bên ngoài
EXPOSE 8080

# Lệnh để khởi chạy ứng dụng khi container bắt đầu
CMD [ "node", "server.js" ]
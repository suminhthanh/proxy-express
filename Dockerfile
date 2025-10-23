# -------------------------------
# ALL-IN-ONE REQUEST FORWARDER
# -------------------------------
FROM node:18-alpine

WORKDIR /app

# Cài đặt dependencies tối thiểu
RUN npm init -y && npm install express axios

# Copy source code
COPY server.js .

EXPOSE 80

CMD ["node", "server.js"]

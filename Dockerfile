FROM node:22-alpine

WORKDIR /app

# Copy package definition files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Create directory for persistent SQLite database and tunnel logs
RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/attendance.sqlite

CMD ["node", "src/index.js"]

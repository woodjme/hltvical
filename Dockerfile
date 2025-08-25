FROM node:24-slim

# Install dependencies
#RUN apt-get update && apt-get install -y \
#    curl \
#    && rm -rf /var/lib/apt/lists/*  # Clean up apt cache
WORKDIR /app
COPY package*.json ./
RUN npm install --production    # Install only production dependencies
COPY . .    
EXPOSE 3000
CMD ["node", "index.js"]

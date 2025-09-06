# Use Python slim base
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node.js (for signaling server)
RUN apt-get update && \
    apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy backend code (Python + Node)
COPY . .

# Expose ports
EXPOSE 5001 4000   
# 5001 = Python API, 4000 = signaling server

# Start both backend and signaling
CMD ["sh", "-c", "python app.py & node signaling_server.js"]


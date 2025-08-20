
# Use lightweight nginx image
FROM nginx:alpine

# Set working directory (not strictly necessary for Nginx)
WORKDIR /usr/share/nginx/html

# Copy all static frontend files to Nginx html folder
COPY public/ /usr/share/nginx/html/

# Copy custom nginx config if needed
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 for Nginx
EXPOSE 80

# Start Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]


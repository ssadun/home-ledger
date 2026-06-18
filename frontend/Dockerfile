FROM nginx:1.27-alpine

# Copy all frontend files to nginx html root
COPY . /usr/share/nginx/html/

# Normalize permissions so the nginx worker (user "nginx") can traverse
# directories and read files regardless of the host's source perms.
# Capital X adds execute only to directories, leaving files non-executable.
RUN chmod -R a+rX /usr/share/nginx/html/

# Override default nginx config with ours
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

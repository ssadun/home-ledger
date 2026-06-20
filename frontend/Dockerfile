FROM nginx:1.27-alpine

# The frontend tree is bind-mounted from the host at runtime (see docker-compose),
# where files are group-owned by "users" (gid 100) with group rwx but no world
# execute. Add the nginx worker user to that group so it can traverse/read the
# mounted files instead of 404-ing with "Permission denied".
RUN addgroup nginx users

# Copy all frontend files to nginx html root
COPY . /usr/share/nginx/html/

# Normalize permissions so the nginx worker (user "nginx") can traverse
# directories and read files regardless of the host's source perms.
# Capital X adds execute only to directories, leaving files non-executable.
RUN chmod -R a+rX /usr/share/nginx/html/

# Override default nginx config with ours
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

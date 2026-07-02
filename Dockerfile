FROM nginx:1.31-alpine

COPY default.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js style.css /usr/share/nginx/html/

EXPOSE 80
